import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeViewWrapper, NodeViewContent } from '@tiptap/react';
import { Check, Circle, LoaderCircle } from 'lucide-react';
import VideoCard from './VideoCard';
import api from '@/services/api';
import { paragraphVideoUrl, safeInstagramUrl } from '@/utils/videoLink';
import './videoPresentation.css';

const metadataCache = new Map();
// Settled results, readable synchronously: a card mounted with known data skips its intro.
const settledMetadata = new Map();
const METADATA_POLL_MS = 2000;
const METADATA_POLL_LIMIT = 30;

// Instagram card data arrives once the server has fetched the reel (it starts on the
// first request), so poll until it is ready or the server reports a failure.
async function loadMetadata(url, platform) {
    for (let attempt = 0; ; attempt += 1) {
        const { data } = await api.get('/notes/video/metadata', { params: { url } });
        if (platform !== 'Instagram' || data.ready) return data;
        if (data.failed || attempt >= METADATA_POLL_LIMIT) return null;
        await new Promise(resolve => setTimeout(resolve, METADATA_POLL_MS));
    }
}

// Typical durations (ms) drive the progress bar between real step changes.
function extractionSteps(platform, step, mode, kind) {
    const write = ['write', mode === 'steps' ? 'Writing the steps' : 'Writing the ideas', 2500];
    if (platform === 'Instagram') {
        // kind is known once the card has loaded; until then assume a reel.
        const look = { photo: 'Looking at the photo', carousel: 'Looking at the slides' }[kind] || 'Watching the video';
        return [
            ['fetch', 'Getting the Instagram post', 8000],
            ['download', kind === 'photo' || kind === 'carousel' ? 'Downloading the slides' : 'Downloading the video', 1500],
            ...(kind === 'photo' ? [] : [['transcribe', 'Transcribing the speech', 1500]]),
            ['look', look, 3500],
            write,
        ];
    }
    if (step === 'watch') return [['subtitles', 'Looking for subtitles', 1500], ['watch', 'Watching the video', 30000]];
    return [['subtitles', 'Reading the subtitles', 1500], write];
}

function ExtractionSteps({ platform, step, mode, kind }) {
    const steps = extractionSteps(platform, step, mode, kind);
    const current = Math.max(0, steps.findIndex(([key]) => key === step));
    const [now, setNow] = useState(Date.now);
    const [started, setStarted] = useState({ step: steps[current][0], at: now });
    if (started.step !== steps[current][0]) setStarted({ step: steps[current][0], at: now });
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 120);
        return () => clearInterval(timer);
    }, []);
    const total = steps.reduce((sum, [, , ms]) => sum + ms, 0);
    const done = steps.slice(0, current).reduce((sum, [, , ms]) => sum + ms, 0);
    // Approaches the end of the current step without ever stalling at a fake 100%.
    const inStep = 1 - Math.exp(-Math.max(0, now - started.at) / steps[current][2]);
    const progress = Math.min(0.97, (done + inStep * 0.95 * steps[current][2]) / total);
    return <div className="mb-2" data-extraction-steps>
        <ul className="m-0 list-none space-y-2 p-0">
            {steps.map(([key, label], index) => <li key={key} className={`flex items-center gap-2 text-sm ${index < current ? 'text-ink-2' : index === current ? 'text-ink' : 'text-ink-3'}`}>
                {index < current ? <Check size={15} strokeWidth={1.8} className="shrink-0 text-primary" />
                    : index === current ? <LoaderCircle size={15} strokeWidth={1.8} className="shrink-0 text-primary motion-safe:animate-spin" />
                    : <Circle size={15} strokeWidth={1.8} className="shrink-0" />}
                {label}
            </li>)}
        </ul>
        <div className="mt-4 h-1 overflow-hidden rounded-full bg-surface-soft" role="progressbar" aria-label="Extraction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div className="h-full rounded-full bg-primary transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
    </div>;
}

function LiveHeading({ mode, hasItems, failed }) {
    const text = mode === 'steps' ? '📋 Steps' : '💡 Main ideas';
    const characters = Array.from(text);
    const [visible, setVisible] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? characters.length : 0);
    useEffect(() => {
        if (visible >= characters.length) return undefined;
        const timer = setTimeout(() => setVisible(count => count + 1), visible ? 38 : 90);
        return () => clearTimeout(timer);
    }, [visible, characters.length]);
    return <h2 className="mb-4 min-h-7 text-lg font-semibold text-ink">
        {characters.slice(0, visible).map((character, index) => <span key={index} className={index ? 'video-ink' : ''}>{character}</span>)}
        {!hasItems && !failed && <span className="video-cursor" aria-hidden="true" />}
    </h2>;
}

export default function VideoParagraphView({ node, editor, getPos }) {
    const candidate = paragraphVideoUrl(node);
    let firstPosition = null;
    if (candidate) editor.state.doc.descendants((child, pos) => {
        if (firstPosition === null && child.type.name === 'paragraph' && paragraphVideoUrl(child) === candidate) firstPosition = pos;
    });
    const url = firstPosition === getPos() ? candidate : null;
    const platform = url && safeInstagramUrl(url) ? 'Instagram' : 'YouTube';
    const sectionRef = useRef(null);
    const [statusTop, setStatusTop] = useState(0);
    const [metadata, setMetadata] = useState(() => url && settledMetadata.has(url) ? { ...settledMetadata.get(url), requestedUrl: url } : null);
    const [failedUrl, setFailedUrl] = useState(null);
    const [presentation, setPresentation] = useState(editor.storage.paragraph.presentation);
    useEffect(() => {
        const update = () => setPresentation(editor.storage.paragraph.presentation);
        editor.on('videoPresentation', update);
        return () => editor.off('videoPresentation', update);
    }, [editor]);
    useEffect(() => {
        if (!url) return;
        let active = true;
        if (!metadataCache.has(url)) {
            if (metadataCache.size >= 128) metadataCache.delete(metadataCache.keys().next().value);
            metadataCache.set(url, loadMetadata(url, platform).then(value => { if (value) settledMetadata.set(url, value); else metadataCache.delete(url); return value; }).catch(() => { metadataCache.delete(url); return null; }));
        }
        metadataCache.get(url).then(value => {
            if (!active) return;
            setMetadata(value ? { ...value, requestedUrl: url } : null);
            setFailedUrl(value ? null : url);
        });
        return () => { active = false; };
    }, [url, platform]);
    const run = presentation?.url === url ? presentation : null;
    const items = run?.items || [];
    useLayoutEffect(() => {
        const section = sectionRef.current;
        if (!section) return;
        const anchor = section.querySelector('li:last-child') || section.querySelector('h2');
        if (!anchor) return;
        const measure = () => setStatusTop(anchor.offsetTop + 3);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(section);
        observer.observe(anchor);
        return () => observer.disconnect();
    }, [items.length, run?.stage]);
    const meta = metadata?.requestedUrl === url ? metadata : null;
    let thumbnail = null;
    try {
        const parsed = new URL(meta?.thumbnail_url);
        if (platform === 'YouTube' && parsed.protocol === 'https:' && ['i.ytimg.com', 'img.youtube.com'].includes(parsed.hostname)) thumbnail = parsed.href;
        // Instagram covers are proxied by the server as data URLs (the CDN blocks other sites).
        if (platform === 'Instagram' && /^data:image\/(jpeg|png|webp);base64,/.test(meta.thumbnail_url)) thumbnail = meta.thumbnail_url;
    } catch { /* Keep local placeholder when metadata is missing. */ }
    const cardStatus = meta ? 'ready' : failedUrl === url ? 'failed' : 'loading';
    const working = run && ['preparing', 'analyzing'].includes(run.stage) && !items.length;
    const status = run?.connection ? 'Reconnecting' : run?.stage === 'error' ? 'Error' : run?.stage === 'done' ? 'Done' : items.length ? 'Streaming' : run?.stage === 'preparing' ? 'Reading' : 'Extracting';
    return <NodeViewWrapper className="video-paragraph">
        <NodeViewContent as="p" />
        {url && <div contentEditable={false} className="not-prose select-text" data-video-card={url}>
            <VideoCard key={url} url={url} platform={platform} meta={meta} thumbnail={thumbnail} status={cardStatus} />
            {run && run.stage !== 'idle' && <section ref={sectionRef} className={`video-live relative ${run.stage === 'done' ? 'h-0' : 'mt-2 pr-20'}`} aria-label="Video extraction">
                <span role="status" style={{ top: run.stage === 'done' ? 24 : statusTop }} className={`video-status absolute right-0 w-16 text-xs text-ink-3 ${run.stage === 'done' ? 'video-status-done' : run.stage !== 'error' ? 'video-status-active' : ''}`}>{status}</span>
                {run.stage !== 'done' && <>
                    <LiveHeading key={run.mode} mode={run.mode} hasItems={items.length > 0} failed={run.stage === 'error'} />
                    {working && <ExtractionSteps platform={platform} step={run.step} mode={run.mode} kind={meta?.kind} />}
                    <ol className="text-sm leading-relaxed text-ink">{items.map((item, i) => <li key={i}>{Array.from(item).map((character, j) => <span className="video-ink" key={j}>{character}</span>)}{i === items.length - 1 && run.stage !== 'error' && <span className="video-cursor" aria-hidden="true" />}</li>)}</ol>
                    {run.detail && <p className="mt-2 text-xs text-ink-3">{run.detail}</p>}
                    {run.stage === 'error' && <p role="alert" className="mt-3 text-sm text-ink-2">{run.error || 'Couldn’t finish the extraction.'} The preview wasn’t saved. Use the button below to try again.</p>}
                </>}
            </section>}
        </div>}
    </NodeViewWrapper>;
}
