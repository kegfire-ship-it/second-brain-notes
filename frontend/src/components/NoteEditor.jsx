import { isCurrentToken, isOfflineReading } from '../services/offlineNotes';
import { useState, useRef, useEffect } from 'react';
import { X, Trash2, Palette, Tags, Check, RotateCcw, Flame, Share2, ListChecks, Lightbulb } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import TipTapEditor from './TipTapEditor';
import GenerateTitleFab from './GenerateTitleFab';
import TitleReveal from './TitleReveal';
import PolishTextFab from './PolishTextFab';
import PolishActionBar from './PolishActionBar';
import { textToParagraphs } from '../utils/polishParagraphs';
import api from '../services/api';
import { watchExtraction, appendExtractionBlock, createExtractionPresentation } from '../services/videoExtraction';
import { videoUrlFromHtml, instagramUrlFromHtml } from '@/utils/videoLink';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COLOR_MAP = {
    white: 'bg-surface',
    red: 'bg-red-50',
    orange: 'bg-orange-50',
    yellow: 'bg-yellow-50',
    lime: 'bg-lime-50', // 10th color added for symmetry!
    green: 'bg-green-50',
    teal: 'bg-teal-50',
    blue: 'bg-blue-50',
    purple: 'bg-purple-50',
    pink: 'bg-pink-50'
};

// Used strictly for the popover buttons so they look vibrant, while cards stay pastel
const VIBRANT_COLOR_MAP = {
    white: 'bg-surface',
    red: 'bg-red-300',
    orange: 'bg-orange-300',
    yellow: 'bg-yellow-300',
    lime: 'bg-lime-300',
    green: 'bg-green-300',
    teal: 'bg-teal-300',
    blue: 'bg-blue-300',
    purple: 'bg-purple-300',
    pink: 'bg-pink-300'
};

const COLOR_KEYS = Object.keys(COLOR_MAP);

// Soft icon button — shared chrome for the editor's footer/header controls.
// Background is supplied per-instance (the note's color) so the chips blend
// into the note instead of reading as white tiles; hover lifts to surface-soft.
const SOFT_ICON_BTN = 'flex items-center justify-center rounded-[11px] border border-line p-2 text-ink-2 transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none';

const normalizeIncomingTitle = (t) => (t === 'Untitled' ? '' : (t || ''));

export default function NoteEditor({ note: incomingNote, categories, onClose, onSave, onDelete, isTrashMode = false, onRestore, onPermanentDelete, onToast }) {
    // A draft gains its durable identity without remounting or replacing live edits.
    const [note, setNote] = useState(incomingNote);
    const persistedNoteRef = useRef(incomingNote);
    const [draftSaving, setDraftSaving] = useState(false);
    const draftSaveRef = useRef(null);
    const closedRef = useRef(false);
    const extractionStartingRef = useRef(false);
    const closeEditor = () => {
        closedRef.current = true;
        titleAbortRef.current?.abort();
        setTitleReveal(null);
        onClose();
    };
    const [title, setTitle] = useState(normalizeIncomingTitle(note?.title));
    const [content, setContent] = useState(note?.content || '');
    const [category, setCategory] = useState(note?.category || '');
    const [color, setColor] = useState(note?.color || 'white');

    // Popover & Action states
    const [showColorMenu, setShowColorMenu] = useState(false);
    const [showCategoryMenu, setShowCategoryMenu] = useState(false);
    const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const [extractionStage, setExtractionStage] = useState(null); // null | "preparing" | "analyzing" | "saving" | "done" | "error"
    const [, setExtractionMode] = useState(null);   // "steps" | "ideas"

    // Viewport state for mobile keyboard
    const [viewport, setViewport] = useState({
        height: window.innerHeight,
        offsetTop: 0
    });

    const modalRef = useRef(null);
    const scrollRef = useRef(null);
    const extractionLock = useRef(false);
    const activeExtractionUrl = useRef(null);
    const [streamVersion, setStreamVersion] = useState(0);
    const [connectionMessage, setConnectionMessage] = useState(null);
    const seenExtractions = useRef(new Set(
        [...(note?.content || '').matchAll(/data-extraction-id=["']([^"']+)["']/g)].map(match => match[1])
    ));
    const saveBaseRef = useRef(note?.content || '');
    // Going offline switches to the reader. Preserve a live unsaved edit using
    // the existing draft recovery flow; it is never uploaded automatically.
    const offlineDraftRef = useRef(null);
    const draftSessionRef = useRef(localStorage.getItem('token'));
    useEffect(() => {
        offlineDraftRef.current = { id: note?.id, title, content, base_content: saveBaseRef.current, category, color, pinned: note?.pinned || false, position: note?.position || Date.now() };
    }, [note, title, content, category, color]);
    useEffect(() => () => {
        if (isTrashMode || closedRef.current || !isOfflineReading() ||
            !isCurrentToken(draftSessionRef.current)) return;
        const draft = offlineDraftRef.current;
        if (draft && (draft.id || draft.title || draft.content)) {
            try { localStorage.setItem('sb_pending_draft', JSON.stringify(draft)); } catch { /* unavailable storage */ }
        }
    }, [isTrashMode]);
    const colorMenuRef = useRef(null);
    const categoryMenuRef = useRef(null);
    const [scrollInfo, setScrollInfo] = useState({ thumbTop: 0, thumbHeight: 0, visible: false });
    const [isScrolled, setIsScrolled] = useState(false);
    const [hasMoreBelow, setHasMoreBelow] = useState(false);
    const [titleFocused, setTitleFocused] = useState(false);
    const [generatingTitle, setGeneratingTitle] = useState(false);
    const titleAbortRef = useRef(null);
    const titleRequestRef = useRef(null);
    const titleEditVersionRef = useRef(0);
    const latestTitleRef = useRef(title);
    latestTitleRef.current = title;
    const [titleReveal, setTitleReveal] = useState(null);
    const unmountedRef = useRef(false);
    // TipTap re-serializes HTML on load (whitespace, self-closing tags, attr
    // order), so the raw note.content no longer matches editor output even when
    // the user changed nothing. Capture the editor's own normalized HTML once on
    // ready and treat that as the "unchanged" baseline — otherwise an untouched
    // note re-saves on Done and jumps to the top of the list.
    const initialContentRef = useRef(null);

    // Polish-selection ("make readable") state
    const [editorInstance, setEditorInstance] = useState(null);
    const [polishSel, setPolishSel] = useState(null);        // { from, to, text } | null
    const [polishLoading, setPolishLoading] = useState(false);
    const [polishActive, setPolishActive] = useState(false); // an applied replacement awaits Apply/Undo
    const polishAbortRef = useRef(null);
    const polishTargetRef = useRef(null);                    // { from, to, text } captured at click
    const polishActiveRef = useRef(false);                   // live mirror for the document Escape handler
    const revertPolishRef = useRef(null);                    // live revert fn for the document Escape handler

    // Reflect the editor's text selection into polishSel (non-empty, >= 10 chars).
    useEffect(() => {
        if (!editorInstance) return undefined;
        const update = () => {
            const sel = editorInstance.state.selection;
            if (sel.empty) {
                setPolishSel(null);
                return;
            }
            const text = editorInstance.state.doc.textBetween(sel.from, sel.to, '\n').trim();
            setPolishSel(text.length >= 10 ? { from: sel.from, to: sel.to, text } : null);
        };
        editorInstance.on('selectionUpdate', update);
        return () => { editorInstance.off('selectionUpdate', update); };
    }, [editorInstance]);

    // Mirror polishActive into a ref so the document-level Escape handler (which
    // closes over a stale render) can revert a pending replacement.
    useEffect(() => {
        polishActiveRef.current = polishActive;
    }, [polishActive]);

    // Snapshot the editor's normalized HTML the first time it's ready — the
    // dirty-check baseline (see initialContentRef above).
    useEffect(() => {
        if (editorInstance && initialContentRef.current === null) {
            initialContentRef.current = editorInstance.getHTML();
        }
    }, [editorInstance]);

    // Dismiss the color / category popovers on any click outside them
    // (clicking the trigger button again still toggles via its own onClick).
    useEffect(() => {
        if (!showColorMenu && !showCategoryMenu) return undefined;
        const handlePointerDown = (e) => {
            if (colorMenuRef.current?.contains(e.target)) return;
            if (categoryMenuRef.current?.contains(e.target)) return;
            setShowColorMenu(false);
            setShowCategoryMenu(false);
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    }, [showColorMenu, showCategoryMenu]);

    // Close on outside click
    const handleBackdropClick = (e) => {
        if (modalRef.current && !modalRef.current.contains(e.target)) {
            closeEditor();
        }
    };

    // Body scroll lock & visual viewport tracking for keyboards
    // Also handle Escape key for unsaved exits
    useEffect(() => {
        unmountedRef.current = false;
        document.body.style.overflow = 'hidden';

        const handleResize = () => {
            if (window.visualViewport) {
                setViewport({
                    height: window.visualViewport.height,
                    offsetTop: window.visualViewport.offsetTop
                });
            } else {
                setViewport({
                    height: window.innerHeight,
                    offsetTop: 0
                });
            }
        };

        const handleKeyDown = (e) => {
            if (e.key === 'Escape') {
                // A pending polish replacement: Escape reverts it instead of
                // closing the whole note editor.
                if (polishActiveRef.current) { revertPolishRef.current?.(); return; }
                closedRef.current = true;
                titleAbortRef.current?.abort();
                setTitleReveal(null);
                onClose();
            }
        };

        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', handleResize);
            window.visualViewport.addEventListener('scroll', handleResize);
            handleResize(); // Initial measurement
            // A short delay helps on iOS Safari where the keyboard resize event is sometimes a frame early
            setTimeout(handleResize, 150);
        } else {
            window.addEventListener('resize', handleResize);
        }

        document.addEventListener('keydown', handleKeyDown);

        return () => {
            unmountedRef.current = true;
            try { titleAbortRef.current?.abort(); } catch { /* no-op */ }
            try { polishAbortRef.current?.abort(); } catch { /* no-op */ }
            if (window.visualViewport) {
                window.visualViewport.removeEventListener('resize', handleResize);
                window.visualViewport.removeEventListener('scroll', handleResize);
            } else {
                window.removeEventListener('resize', handleResize);
            };
        document.removeEventListener('keydown', handleKeyDown);
            setTimeout(() => {
                if (document.querySelectorAll('[data-modal="true"]').length === 0) {
                    document.body.style.overflow = 'unset';
                }
            }, 10);
        };
    }, [onClose]);

    // Scope Cmd/Ctrl+A to the open note. Without this, pressing select-all while
    // focus is outside the editor (the title field's wrapper, a footer button, or
    // the modal shell) lets the browser select the ENTIRE page — including the UI
    // behind the scrim. Keep selection inside the note: a focused input / textarea /
    // contentEditable already confines select-all to itself (the editor's own
    // ProseMirror handler covers the body); anywhere else we redirect into the body.
    useEffect(() => {
        const handleSelectAll = (e) => {
            if (!((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A'))) return;
            const el = document.activeElement;
            const scopesItself =
                el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
            if (scopesItself) return; // browser confines select-all to the field/editable
            e.preventDefault();
            editorInstance?.chain().focus().selectAll().run();
        };
        document.addEventListener('keydown', handleSelectAll);
        return () => document.removeEventListener('keydown', handleSelectAll);
    }, [editorInstance]);

    // Custom scroll indicator tracking
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const update = () => {
            const { scrollTop, scrollHeight, clientHeight } = el;

            setIsScrolled(scrollTop > 4);
            setHasMoreBelow(scrollTop + clientHeight < scrollHeight - 4);

            // Find the sticky header height to position the scroll thumb below it
            const stickyHeader = el.querySelector('[data-sticky-header]');
            const topInset = stickyHeader ? stickyHeader.offsetHeight + 8 : 16;
            const bottomInset = 16; // gap before footer border
            const trackHeight = clientHeight - topInset - bottomInset;

            const ratio = clientHeight / scrollHeight;
            if (ratio >= 1) {
                setScrollInfo({ thumbTop: 0, thumbHeight: 0, visible: false });
            } else {
                const thumbH = Math.max(ratio * trackHeight, 36);
                const maxTop = trackHeight - thumbH;
                const scrollFraction = scrollTop / (scrollHeight - clientHeight);
                const thumbT = scrollFraction * maxTop + topInset;
                setScrollInfo({ thumbTop: thumbT, thumbHeight: thumbH, visible: true });
            }
        };
        update();
        el.addEventListener('scroll', update, { passive: true });
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', update);
            ro.disconnect();
        };
    }, []);

    // Subscribe once the editor is ready. Reopening/reconnecting receives a full
    // snapshot; append only unseen IDs in a transaction that preserves selection.
    useEffect(() => {
        if (!note?.id || !editorInstance || isTrashMode || polishLoading || polishActive) return undefined;
        const publish = snapshot => {
            editorInstance.storage.paragraph.presentation = snapshot;
            editorInstance.emit('videoPresentation');
            setExtractionStage(snapshot.stage === 'idle' ? null : snapshot.stage);
            setExtractionMode(snapshot.mode || null);
            if (!extractionStartingRef.current && ['done', 'error', 'idle'].includes(snapshot.stage)) extractionLock.current = false;
        };
        const finish = snapshot => {
            if (snapshot.block) {
                appendExtractionBlock(editorInstance, snapshot.block, seenExtractions.current);
                if (!saveBaseRef.current.includes(snapshot.block.id)) saveBaseRef.current += snapshot.block.html;
            }
        };
        const presentation = createExtractionPresentation(publish, finish, window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
        const stop = watchExtraction(note.id, snapshot => {
            // A newly persisted draft initially has an idle stream. Keep the start
            // lock/presentation until the start request has been acknowledged.
            if (extractionStartingRef.current && ['idle', 'done', 'error'].includes(snapshot.stage)) return;
            const live = extractionLock.current || (snapshot.stage && !['idle', 'done', 'error'].includes(snapshot.stage));
            if (live) extractionLock.current = true;
            for (const block of [...(snapshot.saved_blocks || [])].reverse()) {
                if (live && block.id === snapshot.id) continue;
                appendExtractionBlock(editorInstance, block, seenExtractions.current);
            }
            for (const block of [...(snapshot.saved_blocks || []), ...(snapshot.block ? [snapshot.block] : [])]) {
                if (seenExtractions.current.has(block.id) && !saveBaseRef.current.includes(block.id)) saveBaseRef.current += block.html;
            }
            const url = snapshot.url || activeExtractionUrl.current;
            if (live || snapshot.stage === 'error') presentation.push({ ...snapshot, url });
            else {
                finish(snapshot);
                publish({ ...snapshot, stage: 'idle', url });
            }
        }, message => {
            setConnectionMessage(message);
            if (editorInstance.storage.paragraph.presentation) {
                editorInstance.storage.paragraph.presentation = { ...editorInstance.storage.paragraph.presentation, connection: message };
                editorInstance.emit('videoPresentation');
            }
        });
        return () => { stop(); presentation.stop(); };

    }, [note?.id, editorInstance, isTrashMode, streamVersion, polishLoading, polishActive]);

    // TipTap outputs HTML like "<p></p>" or "<p><br></p>" for empty content — strip tags to check real emptiness
    const isContentEmpty = (html) => {
        if (!html) return true;
        const text = html.replace(/<[^>]*>/g, '').trim();
        return text.length === 0;
    };

    // Decode entities as well as stripping HTML: the threshold measures real text.
    const getPlainTextLength = (html) => {
        const element = document.createElement('div');
        element.innerHTML = (html || '').replace(/<[^>]*>/g, ' ');
        return (element.textContent || '').replace(/\s+/g, ' ').trim().length;
    };

    const handleGenerateTitle = async () => {
        if (titleRequestRef.current || isTrashMode || closedRef.current || latestTitleRef.current.trim() || getPlainTextLength(content) < 20) return;
        const controller = new AbortController();
        const editVersion = titleEditVersionRef.current;
        titleRequestRef.current = controller;
        titleAbortRef.current = controller;
        setGeneratingTitle(true);
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
            const { data } = await api.post(
                '/notes/generate-title',
                { content },
                { signal: controller.signal }
            );
            if (unmountedRef.current || closedRef.current || controller.signal.aborted || titleRequestRef.current !== controller || titleEditVersionRef.current !== editVersion || latestTitleRef.current.trim()) return;
            if (data?.title) {
                latestTitleRef.current = data.title;
                setTitle(data.title);
                if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) setTitleReveal(data.title);
            }
        } catch (e) {
            if (unmountedRef.current || closedRef.current || titleEditVersionRef.current !== editVersion) return;
            console.error('Title generation error', e);
            if (onToast) onToast('Couldn’t suggest a title');
        } finally {
            clearTimeout(timeout);
            if (titleRequestRef.current === controller) titleRequestRef.current = null;
            if (!unmountedRef.current && !closedRef.current) setGeneratingTitle(false);
        }
    };

    const handlePolish = async () => {
        if (polishLoading || polishActive || !polishSel || !editorInstance) return;
        const { from, to, text } = polishSel;
        polishTargetRef.current = { from, to, text };
        // Lock editing during the call, and keep it locked while the applied
        // replacement awaits Apply/Undo, so it stays a single undoable
        // step (no intervening edits to confuse the revert).
        editorInstance.setEditable(false);
        setPolishLoading(true);
        polishAbortRef.current = new AbortController();
        const timeout = setTimeout(() => {
            try { polishAbortRef.current?.abort(); } catch { /* no-op */ }
        }, 40000); // above the backend's Groq(15s)->Gemini(18s) fallback ceiling
        try {
            const { data } = await api.post(
                '/notes/polish-selection',
                { text },
                { signal: polishAbortRef.current.signal }
            );
            if (unmountedRef.current) return;
            const html = data?.text ? textToParagraphs(data.text) : '';
            if (html) {
                // Replace the selection in place as ONE undoable transaction,
                // then show the confirm bar (editor stays locked until decided).
                editorInstance.setEditable(true);
                editorInstance.chain().insertContentAt({ from, to }, html).run();
                editorInstance.setEditable(false);
                setPolishActive(true);
            } else {
                editorInstance.setEditable(!isTrashMode);
                if (onToast) onToast('Couldn’t edit the text');
            }
        } catch (e) {
            if (unmountedRef.current) return;
            console.error('Polish error', e);
            editorInstance.setEditable(!isTrashMode);
            if (onToast) onToast('Couldn’t edit the text');
        } finally {
            clearTimeout(timeout);
            if (!unmountedRef.current) setPolishLoading(false);
        }
    };

    // ✓ Keep the applied replacement and unlock the editor.
    const handleApplyPolish = () => {
        polishTargetRef.current = null;
        setPolishActive(false);
        if (editorInstance) editorInstance.setEditable(!isTrashMode);
    };

    // ✗ Revert the applied replacement (undo the single insert) and unlock.
    const handleRevertPolish = () => {
        const ed = editorInstance;
        polishTargetRef.current = null;
        setPolishActive(false);
        if (ed) {
            ed.commands.undo();
            ed.setEditable(!isTrashMode);
        }
    };
    // Keep the latest revert fn reachable from the document Escape handler.
    revertPolishRef.current = handleRevertPolish;

    const triggerSave = () => {
        if (draftSaveRef.current) return;
        const trimmedTitle = title.trim();

        // Bug 1: New note with no content — just close, don't create
        if (!note?.id && !trimmedTitle && isContentEmpty(content)) {
            closeEditor();
            return;
        }

        // Bug 2: Existing note with no changes — just close, don't update.
        // Content counts as unchanged if it matches EITHER the raw stored HTML
        // (editor never re-emitted) OR the editor's normalized baseline (editor
        // re-serialized on load). A real edit differs from both.
        if (note?.id) {
            const contentUnchanged =
                content === (note.content || '') ||
                (initialContentRef.current !== null && content === initialContentRef.current);
            const unchanged =
                title === normalizeIncomingTitle(note.title) &&
                contentUnchanged &&
                category === (note.category || '') &&
                color === (note.color || 'white');
            if (unchanged) {
                closeEditor();
                return;
            }
        }

        // Fire the save without awaiting — Dashboard handles it in background.
        // Close the editor immediately so the UI feels instant.
        const finalPosition = note?.id ? (note?.position || 0.0) : Date.now();
        onSave({ id: note?.id, title, content, base_content: saveBaseRef.current, category, color, pinned: note?.pinned || false, position: finalPosition });
        closeEditor();
    };

    const bgColorClass = COLOR_MAP[color] || 'bg-surface';

    const handleShare = async () => {
        if (!note?.id || isSharing) return;
        setIsSharing(true);
        try {
            const { data } = await api.post(`/notes/${note.id}/share`);
            const url = data.url;

            // Try Clipboard API (works on HTTPS in modern browsers)
            if (navigator.clipboard && navigator.clipboard.writeText) {
                try {
                    await navigator.clipboard.writeText(url);
                    if (onToast) onToast('Link copied!');
                    return;
                } catch {
                    // Clipboard API failed — fall through
                }
            }

            // Fallback: prompt with the URL so user can copy manually
            window.prompt('Copy this link:', url);
            if (onToast) onToast('Link copied!');
        } catch (e) {
            console.error('Share error', e);
            if (onToast) onToast('Failed to generate link');
        } finally {
            setIsSharing(false);
        }
    };

    const detectedVideoUrl = videoUrlFromHtml(content) || instagramUrlFromHtml(content);

    const handleAIExtract = async (mode) => {
        if (extractionLock.current || !detectedVideoUrl || (extractionStage && !['done', 'error'].includes(extractionStage))) return;
        extractionLock.current = true;
        extractionStartingRef.current = true;
        activeExtractionUrl.current = detectedVideoUrl;
        setExtractionMode(mode);
        setExtractionStage('preparing');
        if (editorInstance) {
            editorInstance.storage.paragraph.presentation = { url: detectedVideoUrl, mode, stage: 'preparing', items: [] };
            editorInstance.emit('videoPresentation');
        }
        try {
            let savedNote = persistedNoteRef.current;
            if (!savedNote?.id) {
                const draft = { title, content, category, color, pinned: false, position: Date.now() };
                setDraftSaving(true);
                draftSaveRef.current = Promise.resolve().then(() => onSave(draft, { keepOpen: true }));
                try {
                    savedNote = await draftSaveRef.current;
                    if (!savedNote?.id) throw new Error('Save did not return a note id');
                    persistedNoteRef.current = savedNote;
                    if (unmountedRef.current || closedRef.current) return;
                    setNote(savedNote);
                    saveBaseRef.current = draft.content;
                    initialContentRef.current = draft.content;
                } finally {
                    draftSaveRef.current = null;
                    if (!unmountedRef.current && !closedRef.current) setDraftSaving(false);
                }
            }
            if (unmountedRef.current || closedRef.current) return;
            await api.post(`/notes/${savedNote.id}/ai-extract`, {
                url: detectedVideoUrl,
                mode
            });
            if (!unmountedRef.current) setStreamVersion(version => version + 1);
        } catch (e) {
            if (unmountedRef.current || closedRef.current) return;
            console.error('AI extraction error', e);
            if (onToast) onToast(persistedNoteRef.current?.id
                ? 'Couldn’t start the extraction. Please try again.'
                : 'Couldn’t save the note. Please try again.');
            extractionLock.current = false;
            setExtractionStage('error');
            if (editorInstance) {
                editorInstance.storage.paragraph.presentation = { url: detectedVideoUrl, mode, stage: 'error', error: 'Couldn’t start the extraction.' };
                editorInstance.emit('videoPresentation');
            }
        } finally {
            extractionStartingRef.current = false;
        }
    };


    return (
        <div
            data-modal="true"
            className="fixed inset-0 z-50 overflow-hidden"
        >
            {/* The actual scrim that fills the layout viewport entirely */}
            <div
                className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
                onClick={handleBackdropClick}
            />

            {/* The viewport-aware container that perfectly matches the screen above the keyboard. pointer-events-none lets clicks fall through to the backdrop */}
            <div
                className="absolute inset-x-0 w-full flex items-center justify-center sm:p-6 pointer-events-none"
                style={{
                    height: `${viewport.height}px`,
                    top: `${viewport.offsetTop}px`
                }}
            >
                <div
                    ref={modalRef}
                    className={`pointer-events-auto relative w-full h-full sm:max-w-2xl sm:rounded-[20px] border-none sm:border sm:border-line sm:shadow-[var(--shadow-modal)] flex flex-col sm:max-h-[85vh] transition-colors duration-300 animate-in zoom-in-95 ${bgColorClass}`}
                >
                    {/* Scrollable Body containing both Title and Editor */}
                    <div className="relative flex-1 flex flex-col overflow-hidden">
                        <div ref={scrollRef} className="flex-1 overflow-y-auto w-full flex flex-col [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

                        {/* Title and Close Button (Natural scrolling on mobile, sticky on desktop popup) */}
                        <div data-sticky-header className={`sm:sticky sm:top-0 sm:z-10 flex px-4 sm:px-6 py-4 sm:py-5 items-start justify-between flex-shrink-0 ${bgColorClass} sm:rounded-t-[20px] mb-2 sm:mb-0 transition-shadow duration-200 ${isScrolled ? 'sm:shadow-[0_4px_6px_-2px_rgba(0,0,0,0.06)]' : 'shadow-none'}`}>
                            {/* iOS auto-fill trap (invisible field intercepts the aggressive keyboard) */}
                            <input type="password" style={{ display: 'none' }} autoComplete="new-password" aria-hidden="true" tabIndex="-1" />

                            <div className="min-w-0 flex-1">
                                <div className="relative">
                                    <TextareaAutosize
                                        value={title}
                                        aria-label="Note title"
                                        onChange={(e) => {
                                            titleEditVersionRef.current += 1;
                                            latestTitleRef.current = e.target.value;
                                            setTitleReveal(null);
                                            setTitle(e.target.value);
                                        }}
                                        onPointerDown={() => setTitleReveal(null)}
                                        onFocus={() => { setTitleReveal(null); setTitleFocused(true); }}
                                        onBlur={() => setTimeout(() => {
                                            if (!unmountedRef.current) setTitleFocused(false);
                                        }, 150)}
                                        className={cn('block w-full font-display text-[30px] font-medium bg-transparent border-0 outline-none text-ink resize-none leading-tight tracking-[-0.02em] whitespace-pre-wrap [overflow-wrap:anywhere] placeholder:text-ink-3 placeholder:not-italic', titleReveal && 'text-transparent caret-transparent')}
                                        placeholder="Untitled"
                                        spellCheck="false"
                                        autoComplete="new-password"
                                        autoCapitalize="sentences"
                                        data-form-type="other"
                                        data-lpignore="true"
                                        readOnly={isTrashMode}
                                    />
                                    {titleReveal && <TitleReveal title={titleReveal} onComplete={setTitleReveal} />}
                                </div>
                                <GenerateTitleFab
                                    visible={!title.trim() && !isTrashMode && getPlainTextLength(content) >= 20}
                                    loading={generatingTitle}
                                    onClick={handleGenerateTitle}
                                />
                            </div>
                            <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                                {/* Share Button - only for existing notes, not in trash mode */}
                                {note?.id && !isTrashMode && (
                                    <button
                                        onClick={handleShare}
                                        disabled={isSharing}
                                        className={cn(SOFT_ICON_BTN, bgColorClass, isSharing && 'opacity-50')}
                                        title="Copy link"
                                    >
                                        <Share2 size={18} strokeWidth={1.8} />
                                    </button>
                                )}
                                <button
                                    onClick={closeEditor}
                                    aria-label="Close"
                                    className={cn(SOFT_ICON_BTN, bgColorClass, 'flex-shrink-0')}
                                >
                                    <X size={18} strokeWidth={1.8} />
                                </button>
                            </div>
                        </div>

                        <div className="px-4 sm:px-6 pb-8 pt-2 flex-1 flex flex-col">
                            <TipTapEditor describeLinks content={content} onChange={setContent} readOnly={isTrashMode} onEditorReady={setEditorInstance} />
                            {!detectedVideoUrl && extractionStage && <p role="status" className="text-sm text-ink-3">{({ preparing: 'Reading the video…', analyzing: 'Extracting…', saving: 'Saving…', done: 'Saved to the note', error: 'Couldn’t finish the extraction. Please try again.' })[extractionStage]}</p>}
                            {connectionMessage && <p role="status" className="text-sm text-ink-3">{connectionMessage}</p>}
                        </div>
                        </div>

                        {/* Custom soft scroll indicator */}
                        {scrollInfo.visible && (
                            <div
                                className="absolute right-1.5 w-1.5 rounded-full bg-line-3 pointer-events-none z-10"
                                style={{ top: scrollInfo.thumbTop, height: scrollInfo.thumbHeight }}
                            />
                        )}
                    </div>

                    {/* Sticky Footer Action Bar ALWAYS at bottom */}
                    <div className={`px-4 sm:px-6 pt-1.5 pb-[max(0.5rem,calc(env(safe-area-inset-bottom)*0.5))] sm:py-4 flex flex-wrap gap-3 items-center justify-between flex-shrink-0 relative z-20 sm:rounded-b-[20px] ${bgColorClass} transition-shadow duration-200 ${hasMoreBelow ? 'shadow-[0_-4px_6px_-2px_rgba(0,0,0,0.06)]' : 'shadow-none'}`}>
                        {!isTrashMode ? (
                            <>
                                <div className="flex items-center gap-2 relative">
                                    {/* Color Button & Popover */}
                                    <div className="relative" ref={colorMenuRef}>
                                        <button
                                            onClick={() => { setShowColorMenu(!showColorMenu); setShowCategoryMenu(false); }}
                                            className={cn(SOFT_ICON_BTN, bgColorClass)}
                                            title="Change color"
                                        >
                                            <Palette size={18} strokeWidth={1.8} />
                                        </button>

                                        {showColorMenu && (
                                            <div className="absolute bottom-full left-0 mb-3 p-3 rounded-xl border border-line bg-surface shadow-[var(--shadow-md)] grid grid-cols-5 gap-2 w-48 z-50 animate-in fade-in zoom-in-95">
                                                {COLOR_KEYS.map(c => (
                                                    <button
                                                        key={c}
                                                        onClick={() => { setColor(c); setShowColorMenu(false); }}
                                                        className={cn(
                                                            'flex h-7 w-7 items-center justify-center rounded-full border border-line transition-transform',
                                                            VIBRANT_COLOR_MAP[c],
                                                            color === c ? 'scale-105 ring-2 ring-[var(--accent)] ring-offset-1' : 'hover:scale-110',
                                                        )}
                                                        title={c}
                                                    >
                                                        {color === c && <Check size={15} strokeWidth={2.5} className="text-ink" />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Category Button & Popover */}
                                    <div className="relative" ref={categoryMenuRef}>
                                        <button
                                            onClick={() => { setShowCategoryMenu(!showCategoryMenu); setShowColorMenu(false); }}
                                            className={cn(
                                                'flex items-center gap-2 rounded-[11px] border p-2 transition-colors focus:outline-none',
                                                category
                                                    ? 'border-accent-100 bg-accent-50 text-accent-600'
                                                    : 'border-line text-ink-2 hover:bg-surface-soft hover:text-ink',
                                                !category && bgColorClass,
                                            )}
                                            title="Category"
                                        >
                                            <Tags size={18} strokeWidth={1.8} />
                                            {category && <span className="text-xs font-semibold whitespace-nowrap overflow-hidden text-ellipsis max-w-[80px]">{category}</span>}
                                        </button>

                                        {showCategoryMenu && (
                                            <div className="absolute bottom-full left-0 mb-3 rounded-xl border border-line bg-surface shadow-[var(--shadow-md)] w-48 z-50 animate-in fade-in zoom-in-95 flex flex-col py-1.5 overflow-hidden">
                                                <button
                                                    onClick={() => { setCategory(''); setShowCategoryMenu(false); }}
                                                    className={cn(
                                                        'px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-soft',
                                                        !category ? 'bg-accent-50 text-accent-600' : 'text-ink-2',
                                                    )}
                                                >
                                                    No category
                                                </button>
                                                {categories.map(c => (
                                                    <button
                                                        key={c.id}
                                                        onClick={() => { setCategory(c.id); setShowCategoryMenu(false); }}
                                                        className={cn(
                                                            'px-4 py-2 text-left text-sm font-medium transition-colors hover:bg-surface-soft',
                                                            category === c.id ? 'bg-accent-50 text-accent-600' : 'text-ink-2',
                                                        )}
                                                    >
                                                        {c.id}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {note?.id && (
                                        isConfirmingDelete ? (
                                            <div className="flex items-center gap-2 ml-1 animate-in slide-in-from-left-2 duration-200">
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onDelete(note.id);
                                                    }}
                                                    className="flex flex-shrink-0 items-center justify-center rounded-[11px] bg-[var(--danger)] p-2 text-white transition-colors hover:bg-[var(--danger-700)] focus:outline-none"
                                                    title="Confirm delete"
                                                >
                                                    <Check size={18} className="text-white" strokeWidth={2.2} />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setIsConfirmingDelete(false);
                                                    }}
                                                    className={cn(SOFT_ICON_BTN, bgColorClass, 'flex-shrink-0')}
                                                    title="Cancel"
                                                >
                                                    <X size={18} strokeWidth={2.2} />
                                                </button>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={() => {
                                                    setIsConfirmingDelete(true);
                                                    setShowColorMenu(false);
                                                    setShowCategoryMenu(false);
                                                }}
                                                className={cn('flex items-center justify-center rounded-[11px] border border-line p-2 text-[var(--danger)] transition-colors hover:bg-[var(--danger-50)] focus:outline-none ml-1', bgColorClass)}
                                                title="Delete note"
                                            >
                                                <Trash2 size={18} strokeWidth={1.8} />
                                            </button>
                                        )
                                    )}
                                </div>

                                {/* AI Video Extraction — buttons or status lights */}
                                {detectedVideoUrl && (
                                    extractionStage && !['done', 'error'].includes(extractionStage) ? (
                                        <span className="text-sm text-ink-2">Extracting…</span>
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => handleAIExtract('steps')}
                                                className={cn('flex items-center gap-1.5 rounded-[11px] border border-line px-3 py-2 text-ink-2 transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none', bgColorClass)}
                                                title="Get step-by-step instructions from the video"
                                            >
                                                <ListChecks size={18} strokeWidth={1.8} />
                                                <span className="text-xs font-semibold hidden sm:inline">Steps</span>
                                            </button>
                                            <button
                                                onClick={() => handleAIExtract('ideas')}
                                                className={cn('flex items-center gap-1.5 rounded-[11px] border border-line px-3 py-2 text-ink-2 transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none', bgColorClass)}
                                                title="Get the main ideas from the video"
                                            >
                                                <Lightbulb size={18} strokeWidth={1.8} />
                                                <span className="text-xs font-semibold hidden sm:inline">Main ideas</span>
                                            </button>
                                        </div>
                                    )
                                )}

                                <Button onClick={triggerSave} disabled={draftSaving}>
                                    Done
                                </Button>
                            </>
                        ) : (
                            <div className="flex w-full sm:w-auto items-center gap-3 justify-between sm:justify-end flex-1">
                                <Button
                                    onClick={() => onRestore(note.id)}
                                    className="flex-1 sm:flex-none gap-2"
                                >
                                    <RotateCcw size={18} strokeWidth={1.8} />
                                    Restore
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={() => onPermanentDelete(note.id)}
                                    className="flex-1 sm:flex-none gap-2"
                                >
                                    <Flame size={18} strokeWidth={1.8} />
                                    Delete forever
                                </Button>
                            </div>
                        )}
                    </div>

                    <PolishTextFab
                        visible={!!polishSel && !isTrashMode && !titleFocused && !polishActive}
                        loading={polishLoading}
                        onClick={handlePolish}
                        bgColorClass={bgColorClass}
                    />
                    <PolishActionBar
                        visible={polishActive}
                        onApply={handleApplyPolish}
                        onRevert={handleRevertPolish}
                    />
                </div>
            </div>
        </div>
    );
}
