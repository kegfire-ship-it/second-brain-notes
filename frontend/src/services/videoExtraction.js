import api from './api';
import { paragraphVideoUrl, safeVideoUrl } from '../utils/videoLink';

// Fetch supports Authorization headers; native EventSource does not.
export async function readExtractionStream(noteId, onSnapshot, signal) {
    const response = await fetch(`${api.defaults.baseURL}/notes/${encodeURIComponent(noteId)}/extract-stream`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }, signal,
    });
    if (!response.ok) {
        const error = new Error('Couldn’t connect to the extraction');
        error.status = response.status;
        throw error;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminal = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
            let end;
            while ((end = buffer.indexOf('\n\n')) !== -1) {
                const event = buffer.slice(0, end);
                buffer = buffer.slice(end + 2);
                const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
                if (!data) continue;
                const snapshot = JSON.parse(data);
                onSnapshot(snapshot);
                terminal = ['idle', 'done', 'error'].includes(snapshot.stage);
            }
        }
    } finally {
        reader.releaseLock();
    }
    return terminal;
}

export function watchExtraction(noteId, onSnapshot, onConnection, read = readExtractionStream) {
    const controller = new AbortController();
    let timer;
    const connect = async () => {
        try {
            const terminal = await read(noteId, snapshot => {
                if (controller.signal.aborted) return;
                onConnection(null);
                onSnapshot(snapshot);
            }, controller.signal);
            if (terminal || controller.signal.aborted) return;
        } catch (error) {
            if (controller.signal.aborted) return;
            if ([401, 403, 404].includes(error.status)) {
                onConnection('Couldn’t open the extraction. Please reload the page.');
                return;
            }
        }
        onConnection('Reconnecting…');
        timer = setTimeout(connect, 2000);
    };
    connect();
    return () => { controller.abort(); clearTimeout(timer); };
}

export function appendExtractionBlock(editor, block, seen) {
    if (!block?.id || !block.html || seen.has(block.id)) return;
    let exists = false;
    editor.state.doc.descendants(node => {
        if (node.attrs.extractionId === block.id) exists = true;
    });
    if (!exists) {
        let position = editor.state.doc.content.size;
        const source = safeVideoUrl(block.source_url);
        if (source) {
            let anchored = false;
            editor.state.doc.forEach((node, offset) => {
                if (!anchored && node.type.name === 'paragraph' && paragraphVideoUrl(node) === source) {
                    position = offset + node.nodeSize;
                    anchored = true;
                }
            });
        }
        editor.commands.insertContentAt(position, block.html, { updateSelection: false });
    }
    seen.add(block.id);
}

// Each received item gets two seconds, independent of its character count.
export const EXTRACTION_ITEM_DURATION = 2000;
export function createExtractionPresentation(publish, complete, reduced = false) {
    let current = null, schedule = [], timer, committed = false;
    const tick = () => {
        const now = Date.now();
        const items = schedule.map(({ characters, start, end }) => {
            if (!reduced && now < start) return '';
            const progress = reduced ? 1 : Math.min(1, Math.max(0, (now - start) / (end - start)));
            const count = Math.min(characters.length, 1 + Math.floor(progress * (characters.length - 1)));
            return characters.slice(0, count).join('');
        }).filter(Boolean);
        const drained = reduced || !schedule.length || now >= schedule.at(-1).end;
        if (current.stage === 'done' && drained) {
            if (!committed) { committed = true; complete(current); }
            publish({ ...current, items });
        } else {
            publish({ ...current, stage: current.stage === 'done' ? 'analyzing' : current.stage, items });
            if (!drained && current.stage !== 'error') timer = setTimeout(tick, 16);
        }
    };
    return {
        push(snapshot) {
            clearTimeout(timer);
            if (snapshot.id !== current?.id) { schedule = []; committed = false; }
            current = snapshot;
            const arrivedAt = Date.now();
            let nextStart = arrivedAt;
            schedule = (snapshot.items || []).map((item, index) => {
                const characters = Array.from(item);
                const start = schedule[index]?.start ?? Math.max(arrivedAt, nextStart);
                const entry = { characters, start, end: start + EXTRACTION_ITEM_DURATION };
                nextStart = entry.end;
                return entry;
            });
            tick();
        },
        stop() { clearTimeout(timer); },
    };
}
