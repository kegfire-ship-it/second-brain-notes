import { useState, useEffect, useRef, useCallback } from 'react';
import { Plus, Tags, ArrowLeft, Trash2, RefreshCw, Filter, Check, FileText } from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import { arrayMove, SortableContext, rectSortingStrategy, useSortable, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import NoteCard from '../components/NoteCard';
import SwipeableNoteCard from '../components/SwipeableNoteCard';
import NoteEditor from '../components/NoteEditor';
import CategoriesModal from '../components/CategoriesModal';
import ConfirmModal from '../components/ConfirmModal';
import Toast from '../components/Toast';
import MasonryGrid from '../components/MasonryGrid';
import useColumnCount from '../hooks/useColumnCount';
import useInfiniteScroll from '../hooks/useInfiniteScroll';
import useNoteSearch from '../hooks/useNoteSearch';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../services/api';
import { CACHE_KEYS, peek, remember, useCachedState } from '../services/pageCache';
import { fetchNotesFirstPage } from '../services/tabWarmup';
import OfflineStatus from '../components/OfflineStatus';
import AppHeader from '../components/nav/AppHeader';
import { MenuSection } from '../components/nav/AppMenu';
import { Fab } from '@/components/ui/fab';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Tiny tracked-uppercase section label — the ONLY allowed caps (§2 eyebrow).
const EYEBROW = 'text-[11px] font-bold uppercase tracking-[0.14em] text-accent-600';

// Create a sortable wrapper component for the items
const SortableNote = (props) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.id });

    const style = {
        transform: CSS.Translate.toString(transform),
        transition,
        touchAction: 'pan-y',
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners} className={`outline-none ${isDragging ? 'opacity-30 z-0' : 'z-10'}`}>
            <div className={`${isDragging ? 'pointer-events-none' : ''}`}>
                <NoteCard note={props.note} onClick={props.onClick} onTogglePin={props.onTogglePin} onColorChange={props.onColorChange} />
            </div>
        </div>
    );
};

const DRAFT_KEY = 'sb_pending_draft';

export default function Dashboard() {
    // Start from the last-seen grid (instant tab switch); the mount effect
    // refetches it in the background. Written back below.
    const [cachedNotes] = useState(() => peek(CACHE_KEYS.notes));
    const [pinnedNotes, setPinnedNotes] = useState(cachedNotes?.pinnedNotes ?? []);
    const [otherNotes, setOtherNotes] = useState(cachedNotes?.otherNotes ?? []);
    const [otherCursor, setOtherCursor] = useState(cachedNotes?.otherCursor ?? null);
    const [hasMore, setHasMore] = useState(cachedNotes?.hasMore ?? true);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [isLoading, setIsLoading] = useState(!cachedNotes);
    const [categories, setCategories] = useCachedState(CACHE_KEYS.noteCategories, []);
    // `searchInput` = live text in the box; `searchQuery` = the SUBMITTED query
    // (set on Enter) that actually drives the search. Splitting them means we hit
    // Gemini once per Enter instead of on every keystroke pause — the main lever
    // against the 429 rate-limit. Clearing the box exits search immediately.
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchFallbackToastShown, setSearchFallbackToastShown] = useState(false);
    const [isEditorOpen, setIsEditorOpen] = useState(false);
    const [isCategoriesModalOpen, setIsCategoriesModalOpen] = useState(false);
    const [editingNote, setEditingNote] = useState(null);
    const [confirmState, setConfirmState] = useState(null); // { title: '', message: '', onConfirm: () => {} }
    const [isTrashMode, setIsTrashMode] = useState(false);
    const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('sortOrder') || 'newest');
    const [toast, setToast] = useState(null);

    // Filter state
    const [isFilterOpen, setIsFilterOpen] = useState(false);
    const [filterColors, setFilterColors] = useState(new Set());
    const [filterCategories, setFilterCategories] = useState(new Set());
    const hasActiveFilters = filterColors.size > 0 || filterCategories.size > 0;

    const FILTER_COLORS = ['white', 'red', 'orange', 'yellow', 'lime', 'green', 'teal', 'blue', 'purple', 'pink'];
    const VIBRANT_FILTER_MAP = {
        white: 'bg-surface', red: 'bg-red-300', orange: 'bg-orange-300', yellow: 'bg-yellow-300',
        lime: 'bg-lime-300', green: 'bg-green-300', teal: 'bg-teal-300', blue: 'bg-blue-300',
        purple: 'bg-purple-300', pink: 'bg-pink-300'
    };

    const toggleFilterColor = (color) => {
        setFilterColors(prev => {
            const next = new Set(prev);
            next.has(color) ? next.delete(color) : next.add(color);
            return next;
        });
    };

    const toggleFilterCategory = (cat) => {
        setFilterCategories(prev => {
            const next = new Set(prev);
            next.has(cat) ? next.delete(cat) : next.add(cat);
            return next;
        });
    };

    const clearAllFilters = () => {
        setFilterColors(new Set());
        setFilterCategories(new Set());
    };
    const filterRef = useRef(null);
    const filterJustClosed = useRef(false);

    // Always-mounted click blocker — eats the click that follows pointerdown when filter closes
    useEffect(() => {
        const blockClick = (e) => {
            if (filterJustClosed.current) {
                e.preventDefault();
                e.stopPropagation();
                filterJustClosed.current = false;
            }
        };
        document.addEventListener('click', blockClick, true);
        return () => document.removeEventListener('click', blockClick, true);
    }, []);

    // Close filter popover on outside pointerdown — capture phase fires before note handlers
    useEffect(() => {
        if (!isFilterOpen) return;
        const handleOutsidePointerDown = (e) => {
            if (filterRef.current && !filterRef.current.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                setIsFilterOpen(false);
                filterJustClosed.current = true;
            }
        };
        document.addEventListener('pointerdown', handleOutsidePointerDown, true);
        return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    }, [isFilterOpen]);

    // Pull-to-refresh state
    const [pullY, setPullY] = useState(0);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const pullStartY = useRef(0);
    const isPullingRef = useRef(false);
    const pullYRef = useRef(0); // tracks current pull distance (stale-closure-safe)
    const PULL_THRESHOLD = 70;  // px needed to trigger refresh
    const PULL_MAX = 100;       // max visual drag distance

    useEffect(() => {
        localStorage.setItem('sortOrder', sortOrder);
    }, [sortOrder]);

    // DnD state
    const [activeId, setActiveId] = useState(null);
    const [dragRect, setDragRect] = useState(null);
    const sensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        fetchCategories();
        if (isTrashMode) {
            fetchTrash();
        } else {
            fetchInitial();
        }

        // Recover any draft that failed to save (e.g. session expired mid-save)
        try {
            const raw = localStorage.getItem(DRAFT_KEY);
            if (raw) {
                const draft = JSON.parse(raw);
                setToast({ message: 'Unsaved note recovered.', draft });
            }
        } catch {
            localStorage.removeItem(DRAFT_KEY);
        }

        // --- Pull-to-refresh touch handlers ---
        const onTouchStart = (e) => {
            // Only begin tracking if at the absolute top of the page
            if (window.scrollY !== 0) return;
            pullStartY.current = e.touches[0].clientY;
            isPullingRef.current = false;
        };

        const onTouchMove = (e) => {
            if (window.scrollY !== 0) return;
            const delta = e.touches[0].clientY - pullStartY.current;
            // Only engage on a strict downward pull
            if (delta <= 0) return;
            isPullingRef.current = true;
            // Apply rubber-band damping: sqrt curve so early pull feels snappy, late feels resistant
            const dampened = Math.min(Math.sqrt(delta) * 6, PULL_MAX);
            pullYRef.current = dampened;
            setPullY(dampened);
        };

        const onTouchEnd = async () => {
            if (!isPullingRef.current) return;
            isPullingRef.current = false;

            if (pullYRef.current >= PULL_THRESHOLD) {
                setIsRefreshing(true);
                pullYRef.current = PULL_MAX;
                setPullY(PULL_MAX); // lock indicator in place while fetching
                try {
                    await Promise.all([
                        isTrashMode ? fetchTrash() : refetchAll(),
                        fetchCategories(),
                    ]);
                } finally {
                    setIsRefreshing(false);
                }
            }
            // Snap back regardless
            pullYRef.current = 0;
            setPullY(0);
        };

        document.addEventListener('touchstart', onTouchStart, { passive: true });
        document.addEventListener('touchmove', onTouchMove, { passive: true });
        document.addEventListener('touchend', onTouchEnd);

        return () => {
            document.removeEventListener('touchstart', onTouchStart);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onTouchEnd);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchCategories = async () => {
        try {
            const { data } = await api.get('/categories');
            setCategories(data);
        } catch (err) {
            console.error(err);
        }
    };

    // Search mode: fed by useNoteSearch when searchQuery is non-empty.
    const fallbackPool = [...pinnedNotes, ...otherNotes];
    const { results: searchResults, status: searchStatus } = useNoteSearch(
        searchQuery, fallbackPool,
    );
    // How many search cards to show; Show more adds a page, a new query resets it.
    const SEARCH_PAGE = 50;
    const [searchShowCount, setSearchShowCount] = useState(SEARCH_PAGE);
    useEffect(() => { setSearchShowCount(SEARCH_PAGE); }, [searchQuery]);

    // One-shot toast when we slip into fallback mode.
    useEffect(() => {
        if (searchStatus === 'fallback' && !searchFallbackToastShown) {
            setToast({ message: 'Searching offline, so results may be incomplete' });
            setSearchFallbackToastShown(true);
        }
        if (searchStatus === 'idle') {
            setSearchFallbackToastShown(false);
        }
    }, [searchStatus, searchFallbackToastShown]);

    // Deep-link: another page (e.g. a project's notes) can navigate here with
    // { state: { openNoteId } } to open that note's editor. Always fetch the note
    // itself — the grid may still be the last-seen (cached) copy while it
    // refreshes — then clear the state so it fires once.
    const openNoteId = location.state?.openNoteId;
    useEffect(() => {
        if (!openNoteId) return;
        api.get(`/notes/${openNoteId}`)
            .then((r) => {
                setEditingNote(r.data);
                setIsEditorOpen(true);
                navigate('/', { replace: true, state: {} });
            })
            .catch(() => {});
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [openNoteId]);

    const fetchInitial = async () => {
        try {
            const page = await fetchNotesFirstPage();
            setPinnedNotes(page.pinnedNotes);
            setOtherNotes(page.otherNotes);
            setOtherCursor(page.otherCursor);
            setHasMore(page.hasMore);
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadMore = useCallback(async () => {
        if (!hasMore || isLoadingMore || !otherCursor || isTrashMode) return;
        setIsLoadingMore(true);
        try {
            const { data } = await api.get('/notes', {
                params: { pinned: false, after: otherCursor, limit: 100 },
            });
            setOtherNotes(prev => [...prev, ...data]);
            if (data.length > 0) {
                setOtherCursor(data[data.length - 1].id);
            }
            if (data.length < 100) setHasMore(false);
        } catch (err) {
            console.error('loadMore failed', err);
        } finally {
            setIsLoadingMore(false);
        }
    }, [hasMore, isLoadingMore, otherCursor, isTrashMode]);

    const refetchAll = async () => {
        setOtherNotes([]);
        setOtherCursor(null);
        setHasMore(true);
        setIsLoading(true);
        await fetchInitial();
    };

    const fetchTrash = async () => {
        try {
            const { data } = await api.get('/notes/trash');
            setPinnedNotes([]);  // trash has no pin section
            setOtherNotes(data);
            setHasMore(false);   // trash isn’t paginated
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };

    useInfiniteScroll(loadMore, { threshold: 1, enabled: !isTrashMode && hasMore });

    // Keep the cached grid in step with what's on screen (incl. optimistic
    // edits). Trash contents and a mid-refetch empty list are never cached.
    useEffect(() => {
        if (isTrashMode || isLoading) return;
        remember(CACHE_KEYS.notes, { pinnedNotes, otherNotes, otherCursor, hasMore });
    }, [isTrashMode, isLoading, pinnedNotes, otherNotes, otherCursor, hasMore]);

    const handleDeleteNote = async (noteOrId) => {
        const noteId = typeof noteOrId === 'object' ? noteOrId.id : noteOrId;
        if (!noteId) return;
        const snapshotPinned = pinnedNotes;
        const snapshotOther = otherNotes;
        setPinnedNotes(prev => prev.filter(n => n.id !== noteId));
        setOtherNotes(prev => prev.filter(n => n.id !== noteId));
        setIsEditorOpen(false);
        try {
            await api.delete(`/notes/${noteId}`);
        } catch (e) {
            console.error("Delete error", e);
            setPinnedNotes(snapshotPinned);
            setOtherNotes(snapshotOther);
            setToast({ message: 'Failed to delete note.' });
        }
    };

    const handleRestoreNote = async (noteId) => {
        const snapshotOther = otherNotes;
        // In trash mode, the note is in otherNotes (trash list). Optimistically remove.
        setOtherNotes(prev => prev.filter(n => n.id !== noteId));
        setIsEditorOpen(false);
        try {
            await api.post(`/notes/${noteId}/restore`);
        } catch (e) {
            console.error("Restore error", e);
            setOtherNotes(snapshotOther);
            setToast({ message: 'Failed to restore note.' });
        }
    };

    const handleSwipeDelete = async (note) => {
        // Optimistically remove from UI
        setOtherNotes(prev => prev.filter(n => n.id !== note.id));
        // Pinned notes can't be swipe-deleted (they're behind dnd) so we don't touch pinnedNotes.
        // Fire soft-delete request
        try {
            await api.delete(`/notes/${note.id}`);
        } catch (e) {
            console.error('Swipe delete error', e);
        }
        // Show toast with undo
        setToast({ noteData: note, message: 'Note moved to trash.' });
    };

    const handleUndoDelete = async () => {
        if (!toast?.noteData) return;
        const note = toast.noteData;
        // Re-insert into otherNotes (swipe-delete only ever removes from otherNotes).
        setOtherNotes(prev => [note, ...prev]);
        setToast(null);
        try {
            await api.post(`/notes/${note.id}/restore`);
        } catch (e) {
            console.error('Undo restore error', e);
            // Revert: remove the re-inserted note.
            setOtherNotes(prev => prev.filter(n => n.id !== note.id));
            setToast({ message: 'Failed to undo. Note stays in trash.' });
        }
    };

    const handlePermanentDeleteNote = async (noteId) => {
        const snapshotOther = otherNotes;
        // In trash mode, the note is in otherNotes. Optimistically remove.
        setOtherNotes(prev => prev.filter(n => n.id !== noteId));
        setIsEditorOpen(false);
        setConfirmState(null);
        try {
            await api.delete(`/notes/${noteId}/permanent`);
        } catch (e) {
            console.error("Perm_delete error", e);
            setOtherNotes(snapshotOther);
            setToast({ message: 'Failed to delete note permanently.' });
        }
    };

    const handleSaveNote = async (noteData, { keepOpen = false } = {}) => {
        // Persist draft before API call — if the session expires or network drops,
        // the note content survives in localStorage and is offered for restore on next login.
        localStorage.setItem(DRAFT_KEY, JSON.stringify(noteData));

        // UPDATE path: optimistic in-place + handle pin-toggle bucket move.
        if (noteData.id) {
            const snapshotPinned = pinnedNotes;
            const snapshotOther = otherNotes;
            const wasPinned = pinnedNotes.some(n => n.id === noteData.id);
            const willBePinned = !!noteData.pinned;
            const currentNote = wasPinned
                ? pinnedNotes.find(n => n.id === noteData.id)
                : otherNotes.find(n => n.id === noteData.id);
            const merged = { ...(currentNote || {}), ...noteData };

            if (wasPinned === willBePinned) {
                if (willBePinned) {
                    // Pinned: in-place .map() — preserves manual drag order.
                    setPinnedNotes(prev => prev.map(n => n.id === noteData.id ? merged : n));
                } else {
                    // Unpinned: move to top to match backend mtime-DESC sort after save.
                    setOtherNotes(prev => [merged, ...prev.filter(n => n.id !== noteData.id)]);
                }
            } else if (willBePinned) {
                // Moved unpinned → pinned: remove from other, prepend to pinned.
                setOtherNotes(prev => prev.filter(n => n.id !== noteData.id));
                setPinnedNotes(prev => [merged, ...prev]);
            } else {
                // Moved pinned → unpinned: remove from pinned, prepend to other.
                setPinnedNotes(prev => prev.filter(n => n.id !== noteData.id));
                setOtherNotes(prev => [merged, ...prev]);
            }

            if (!keepOpen) setIsEditorOpen(false);
            try {
                const { data: saved } = await api.put(`/notes/${noteData.id}`, noteData);
                // The server may merge a concurrently completed video extraction.
                if (saved?.id) {
                    setPinnedNotes(prev => prev.map(n => n.id === saved.id ? { ...n, ...saved } : n));
                    setOtherNotes(prev => prev.map(n => n.id === saved.id ? { ...n, ...saved } : n));
                }
                localStorage.removeItem(DRAFT_KEY);
                return saved;
            } catch (e) {
                console.error("Save error", e);
                setPinnedNotes(snapshotPinned);
                setOtherNotes(snapshotOther);
                const msg = e.response?.status === 401
                    ? 'Session expired. Logging out…'
                    : 'Failed to save note. Check your connection.';
                setToast({ message: msg });
                if (keepOpen) throw e;
            }
            return;
        }

        // CREATE path: no id yet, so no optimistic insert. POST, then prepend response.
        if (!keepOpen) setIsEditorOpen(false);
        try {
            const { data } = await api.post('/notes', noteData);
            if (!data?.id) throw new Error('Save did not return a note id');
            localStorage.removeItem(DRAFT_KEY);
            if (data?.pinned) {
                setPinnedNotes(prev => [data, ...prev]);
            } else {
                setOtherNotes(prev => [data, ...prev]);
            }
            return data;
        } catch (e) {
            console.error("Save error", e);
            const msg = e.response?.status === 401
                ? 'Session expired. Logging out…'
                : 'Failed to save note. Check your connection.';
            setToast({ message: msg });
            if (keepOpen) throw e;
        }
    };

    const handleAddCategory = async (name) => {
        try {
            await api.post('/categories', [...categories, { id: name }]);
            fetchCategories();
        } catch (e) { console.error(e); }
    };

    const handleEditCategory = async (oldName, newName) => {
        const renameNote = (n) => n.category === oldName ? { ...n, category: newName } : n;
        setCategories(prev => prev.map(c => c.id === oldName ? { ...c, id: newName } : c));
        setPinnedNotes(prev => prev.map(renameNote));
        setOtherNotes(prev => prev.map(renameNote));
        try {
            await api.put(`/categories/${encodeURIComponent(oldName)}`, { new_name: newName });
        } catch (e) {
            console.error(e);
            // Fall back to refetch on error — manually reverting category renames across all
            // notes is fiddly and category errors are rare.
            fetchCategories();
            refetchAll();
            setToast({ message: 'Failed to rename category.' });
        }
    };

    const handleDeleteCategory = async (name) => {
        setConfirmState({
            title: "Delete category",
            message: `Delete the category "${name}"? Its notes will stay, without a category.`,
            confirmText: "Delete",
            onConfirm: async () => {
                setConfirmState(null);
                const clearCat = (n) => n.category === name ? { ...n, category: '' } : n;
                setCategories(prev => prev.filter(c => c.id !== name));
                setPinnedNotes(prev => prev.map(clearCat));
                setOtherNotes(prev => prev.map(clearCat));
                try {
                    await api.delete(`/categories/${encodeURIComponent(name)}`);
                } catch (e) {
                    console.error(e);
                    fetchCategories();
                    refetchAll();
                    setToast({ message: 'Failed to delete category.' });
                }
            }
        });
    };

    const handleTogglePin = async (note) => {
        const toggled = { ...note, pinned: !note.pinned };
        await handleSaveNote(toggled);
    };

    const handleColorChange = async (note, newColor) => {
        const apply = (n) => n.id === note.id ? { ...n, color: newColor } : n;
        const revert = (n) => n.id === note.id ? note : n;
        // Optimistic — apply to whichever bucket the note lives in
        setPinnedNotes(prev => prev.map(apply));
        setOtherNotes(prev => prev.map(apply));
        try {
            await api.put(`/notes/${note.id}`, { ...note, color: newColor });
            // No localStorage cache anymore — successful save is the source of truth on next refetch
        } catch (e) {
            console.error('Color change error', e);
            setPinnedNotes(prev => prev.map(revert));
            setOtherNotes(prev => prev.map(revert));
        }
    };

    // Color + category filters only. Search filtering is owned by useNoteSearch
    // (when active) or skipped entirely (browse mode).
    const noteMatchesFilters = (n) => {
        if (filterColors.size > 0 && !filterColors.has(n.color || 'white')) return false;
        if (filterCategories.size > 0 && !filterCategories.has(n.category || '')) return false;
        return true;
    };

    // Search mode active when the hook returned results; otherwise browse mode.
    const inSearchMode = searchResults !== null;

    const sourcePinned = inSearchMode ? searchResults.pinned : pinnedNotes;
    const sourceOther = inSearchMode ? searchResults.other : otherNotes;

    const displayPinned = sourcePinned.filter(noteMatchesFilters);
    let displayOther = sourceOther.filter(noteMatchesFilters);
    if (sortOrder === 'oldest') {
        displayOther = [...displayOther].reverse();
    }

    // Apply the display cap in search mode (pinned shown in full first).
    const SEARCH_DISPLAY_CAP = searchShowCount;
    let cappedPinned = displayPinned;
    let cappedOther = displayOther;
    let searchTotalShown = 0;
    if (inSearchMode) {
        const pinnedCount = displayPinned.length;
        const remaining = Math.max(0, SEARCH_DISPLAY_CAP - pinnedCount);
        cappedPinned = displayPinned.slice(0, SEARCH_DISPLAY_CAP);
        cappedOther = displayOther.slice(0, remaining);
        searchTotalShown = cappedPinned.length + cappedOther.length;
    }

    // DnD Handlers
    const handleDragStart = (event) => {
        const activeNote = [...pinnedNotes, ...otherNotes].find(n => n.id === event.active.id);

        // Option B: Strictly disable drag mechanics for non-pinned notes under rigid Date sorting.
        if (activeNote && !activeNote.pinned) return;

        setActiveId(event.active.id);
        const rect = event.active.rect.current?.initial;
        if (rect) {
            setDragRect({ width: rect.width, height: rect.height });
        }
    };

    const handleDragEnd = async (event) => {
        const { active, over } = event;
        setActiveId(null);
        setDragRect(null);
        if (!over || active.id === over.id) return;

        const all = [...pinnedNotes, ...otherNotes];
        const activeNote = all.find(n => n.id === active.id);
        const overNote = all.find(n => n.id === over.id);
        if (!activeNote || !overNote) return;

        // Prevent dragging between Pinned and Others
        if (activeNote.pinned !== overNote.pinned) {
            return;
        }

        // Failsafe: Only allow ordering Pinned notes
        if (!activeNote.pinned) {
            return;
        }

        // Map strictly using the same custom position sorting used functionally
        const sameGroupNotes = [...pinnedNotes].sort((a, b) => (b.position || 0) - (a.position || 0));

        const oldIndex = sameGroupNotes.findIndex(n => n.id === active.id);
        const targetIndex = sameGroupNotes.findIndex(n => n.id === over.id);
        const reordered = arrayMove(sameGroupNotes, oldIndex, targetIndex);

        const movedIndex = reordered.findIndex(n => n.id === active.id);
        // Baseline default start at bottom or keep existing if not moving
        let newPos = activeNote.position || Date.now();

        if (reordered.length > 1) {
            if (movedIndex === 0) {
                // Highest position
                newPos = (reordered[1].position || 0) + 1000;
            } else if (movedIndex === reordered.length - 1) {
                // Lowest position
                newPos = (reordered[reordered.length - 2].position || 0) - 1000;
            } else {
                // Midpoint calculation between neighbors
                const prev = reordered[movedIndex - 1].position || 0;
                const next = reordered[movedIndex + 1].position || 0;
                newPos = (prev + next) / 2;
            }
        }

        const updatedNote = { ...activeNote, position: newPos };

        setPinnedNotes(prev => prev.map(n => n.id === active.id ? updatedNote : n));
        await api.put(`/notes/${active.id}`, updatedNote);
    };

    const grid = useColumnCount();

    return (
        <div className="min-h-screen bg-background flex flex-col">

            {/* Pull-to-refresh indicator — slides down from top, snaps back with spring */}
            <div
                aria-hidden="true"
                style={{
                    transform: `translateY(${pullY > 0 ? pullY - 44 : -44}px)`,
                    transition: pullY === 0 ? 'transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none',
                    opacity: pullY > 0 ? Math.min(pullY / 44, 1) : 0,
                }}
                className="fixed top-0 left-1/2 -translate-x-1/2 z-50 flex items-center justify-center w-10 h-10 bg-surface border border-line rounded-full shadow-[var(--shadow-md)] pointer-events-none text-ink-2"
            >
                <RefreshCw
                    size={18}
                    strokeWidth={1.8}
                    className={isRefreshing ? 'animate-spin' : ''}
                    style={{
                        transform: !isRefreshing ? `rotate(${(pullY / 100) * 360}deg)` : undefined,
                    }}
                />
            </div>

            {/* Top Navigation */}
            {isTrashMode ? (
              <AppHeader>
                <button
                  type="button"
                  className="appnav-iconbtn"
                  style={{ width: 'auto', gap: 8, padding: '0 14px' }}
                  onClick={() => { setIsTrashMode(false); refetchAll(); }}
                >
                  <ArrowLeft size={18} strokeWidth={1.8} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Notes</span>
                </button>
              </AppHeader>
            ) : (
              <AppHeader
                search={{
                  value: searchInput,
                  onChange: (val) => {
                    setSearchInput(val);
                    // Emptying the box leaves search mode right away.
                    if (val === '') setSearchQuery('');
                  },
                  onSubmit: (val) => setSearchQuery(val.trim()),
                  placeholder: 'Search notes',
                  children: (
                    <>
                      {searchQuery && searchStatus === 'loading' && (
                        <span
                          className="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin text-ink-3"
                          aria-label="Searching"
                          title="Searching"
                        />
                      )}
                      {searchQuery && searchStatus === 'fallback' && (
                        <span
                          className="text-xs font-semibold text-ink-3 pointer-events-none"
                          title="The server isn’t reachable, so only loaded notes are searched"
                        >
                          offline
                        </span>
                      )}
                    </>
                  ),
                }}
                menu={{
                  top: (
                    <MenuSection label="Sort">
                      <div className="flex flex-col gap-2">
                        {[['newest', 'Newest first'], ['oldest', 'Oldest first']].map(([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setSortOrder(val)}
                            className={cn(
                              'w-full text-left px-4 py-2.5 rounded-xl border text-sm font-medium transition-colors',
                              sortOrder === val
                                ? 'border-accent-100 bg-accent-50 text-accent-600'
                                : 'border-line bg-surface text-ink-2 hover:bg-surface-soft',
                            )}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </MenuSection>
                  ),
                  items: [
                    { label: 'Categories', Icon: Tags, onClick: () => setIsCategoriesModalOpen(true) },
                    { label: 'Trash', Icon: Trash2, onClick: () => { setIsTrashMode(true); fetchTrash(); } },
                  ],
                }}
              >
                <div className="relative flex-shrink-0" ref={filterRef}>
                  <button
                    type="button"
                    onPointerDown={(e) => { e.stopPropagation(); setIsFilterOpen(!isFilterOpen); }}
                    className="appnav-iconbtn"
                    aria-label="Filter notes"
                    style={hasActiveFilters ? { borderColor: 'var(--accent-100)', color: 'var(--accent-600)', background: 'var(--accent-50)' } : undefined}
                  >
                    <Filter size={18} strokeWidth={1.8} />
                  </button>
                  {isFilterOpen && (
                    <div className="absolute right-0 top-full mt-3 w-72 sm:w-80 p-4 bg-surface border border-line rounded-2xl shadow-[var(--shadow-md)] z-40 flex flex-col gap-4">
                      <div>
                        <h3 className={cn(EYEBROW, 'mb-3')}>Colors</h3>
                        <div className="grid grid-cols-5 gap-2">
                          {FILTER_COLORS.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onPointerDown={(e) => { e.stopPropagation(); toggleFilterColor(c); }}
                              className={cn(
                                'w-9 h-9 rounded-full border border-line transition-transform flex items-center justify-center',
                                VIBRANT_FILTER_MAP[c],
                                filterColors.has(c) ? 'scale-105 ring-2 ring-[var(--accent)] ring-offset-1' : 'hover:scale-110',
                              )}
                              title={c}
                            >
                              {filterColors.has(c) && <Check size={15} strokeWidth={2} className="text-ink" />}
                            </button>
                          ))}
                        </div>
                      </div>
                      {categories.length > 0 && (
                        <div>
                          <h3 className={cn(EYEBROW, 'mb-3')}>Categories</h3>
                          <div className="flex flex-wrap gap-2">
                            {categories.map((cat) => (
                              <button
                                key={cat.id}
                                type="button"
                                onPointerDown={(e) => { e.stopPropagation(); toggleFilterCategory(cat.id); }}
                                className={cn(
                                  'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                                  filterCategories.has(cat.id)
                                    ? 'border-accent-100 bg-accent-50 text-accent-600'
                                    : 'border-line bg-surface text-ink-2 hover:bg-surface-soft',
                                )}
                              >
                                {cat.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {hasActiveFilters && (
                        <button
                          type="button"
                          onPointerDown={(e) => { e.stopPropagation(); clearAllFilters(); }}
                          className="w-full border-t border-line pt-3 text-center text-sm font-semibold text-ink-2 transition-colors hover:text-[var(--accent)]"
                        >
                          Clear filters
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </AppHeader>
            )}

            {/* Main Content Area */}
            <main className="flex-1 w-full max-w-[1120px] mx-auto px-3 md:px-6 pt-4 pb-32">
                <OfflineStatus />

                {/* Trash keeps its label; the normal "Notes" title is redundant
                    with the nav, so it's omitted to keep notes high on the page. */}
                {isTrashMode && (
                    <div className="mb-8">
                        <h1 className="font-display text-[26px] font-medium tracking-tight text-ink">
                            Trash
                        </h1>
                    </div>
                )}

                {searchInput.trim().length > 0 && searchInput.trim().length < 3 && (
                    <p className="text-center text-sm text-ink-3 mt-6 mb-6">
                        Type at least 3 characters
                    </p>
                )}
                {searchInput.trim().length >= 3 && searchInput.trim() !== searchQuery && !inSearchMode && (
                    <p className="text-center text-sm text-ink-3 mt-6 mb-6">
                        Press Enter to search
                    </p>
                )}
                {inSearchMode && searchResults && searchResults.total === 0 && searchStatus !== 'loading' && (
                    <p className="text-center text-sm text-ink-3 mt-6 mb-6">
                        Nothing found
                    </p>
                )}

                {/* Drag & Drop Context — Pinned notes only */}
                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                >
                    {/* Pinned Section */}
                    {cappedPinned.length > 0 && (
                        <div className="mb-8">
                            <SortableContext items={cappedPinned.map(n => n.id)} strategy={rectSortingStrategy}>
                                <MasonryGrid
                                    grid={grid}
                                    items={cappedPinned}
                                    renderItem={(note) => (
                                        <SortableNote
                                            id={note.id}
                                            note={note}
                                            onClick={() => { setEditingNote(note); setIsEditorOpen(true); }}
                                            onTogglePin={handleTogglePin}
                                            onColorChange={handleColorChange}
                                            onDelete={handleDeleteNote}
                                        />
                                    )}
                                />
                            </SortableContext>
                        </div>
                    )}

                    <DragOverlay dropAnimation={{
                        duration: 250,
                        easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)',
                    }}>
                        {activeId ? (
                            <div
                                style={dragRect ? { width: dragRect.width } : {}}
                                className="scale-[1.02] shadow-[var(--shadow-md)] opacity-100 cursor-grabbing rounded-xl pointer-events-none"
                            >
                                <NoteCard
                                    note={[...pinnedNotes, ...otherNotes].find(n => n.id === activeId)}
                                    onClick={() => { }}
                                    onTogglePin={() => { }}
                                />
                            </div>
                        ) : null}
                    </DragOverlay>
                </DndContext>

                {/* Other Notes Section — outside DndContext so TouchSensor doesn't block swipe gestures */}
                {cappedOther.length > 0 && (
                    <div>
                        <MasonryGrid
                            grid={grid}
                            items={cappedOther}
                            renderItem={(note) => (
                                <SwipeableNoteCard
                                    note={note}
                                    onClick={() => { setEditingNote(note); setIsEditorOpen(true); }}
                                    onTogglePin={handleTogglePin}
                                    onSwipeDelete={handleSwipeDelete}
                                    onColorChange={handleColorChange}
                                />
                            )}
                        />
                    </div>
                )}

                {/* Bottom skeleton loader — shown while fetching the next page */}
                {isLoadingMore && !isTrashMode && (
                    <div className="mt-4 flex flex-wrap justify-center gap-4">
                        {[0, 1, 2].map(i => (
                            <div
                                key={i}
                                className="w-[290px] h-[150px] rounded-xl border border-line bg-surface-soft animate-pulse"
                            />
                        ))}
                    </div>
                )}

                {/* In fallback mode, .total reflects local-pool matches, not corpus totals — suppress the cap footer. */}
                {inSearchMode && searchResults && searchResults.total > SEARCH_DISPLAY_CAP && searchStatus !== 'fallback' && (
                    <div className="mt-4 flex flex-col items-center gap-2">
                        <Button variant="outline" onClick={() => setSearchShowCount(c => c + SEARCH_PAGE)}>
                            Show more
                        </Button>
                        <p className="text-center text-ink-3 text-sm">
                            Showing {searchTotalShown} of {searchResults.total}
                        </p>
                    </div>
                )}

                {
                    !isLoading && !inSearchMode && cappedPinned.length === 0 && cappedOther.length === 0 && (
                        <div className="mx-auto mt-16 max-w-lg sm:mt-24">
                            {hasActiveFilters ? (
                                <EmptyState
                                    icon={<Filter size={22} strokeWidth={1.8} />}
                                    title="No notes match these filters"
                                    description="Try changing or clearing the filters."
                                    action={<Button onClick={clearAllFilters}>Clear filters</Button>}
                                />
                            ) : (
                                <EmptyState
                                    icon={<FileText size={22} strokeWidth={1.8} />}
                                    title="Nothing here yet"
                                    description="Press the button to write down your first idea."
                                    action={(
                                        <Button onClick={() => { setEditingNote(null); setIsEditorOpen(true); }}>
                                            <Plus size={18} strokeWidth={1.8} /> New note
                                        </Button>
                                    )}
                                />
                            )}
                        </div>
                    )
                }
            </main >

            {/* Floating Action Button */}
            {
                !isTrashMode && (
                    <Fab
                        onClick={() => { setEditingNote(null); setIsEditorOpen(true); }}
                        aria-label="New note"
                        className="fixed right-6 z-40 sm:right-10"
                        style={{ bottom: 'max(1.5rem, env(safe-area-inset-bottom, 1.5rem))', boxShadow: 'var(--glow-accent)' }}
                    >
                        <Plus size={20} strokeWidth={1.8} />
                        <span>New note</span>
                    </Fab>
                )
            }

            {/* Editor Modal */}
            {
                isEditorOpen && (
                    <NoteEditor
                        note={editingNote}
                        categories={categories}
                        onClose={() => setIsEditorOpen(false)}
                        onSave={handleSaveNote}
                        onDelete={handleDeleteNote}
                        isTrashMode={isTrashMode}
                        onRestore={handleRestoreNote}
                        onToast={(msg) => setToast({ message: msg })}
                        onPermanentDelete={(id) => setConfirmState({
                            title: 'Delete forever',
                            message: 'Delete this note forever? This can’t be undone.',
                            confirmText: 'Delete forever',
                            onConfirm: () => handlePermanentDeleteNote(id)
                        })}
                    />
                )
            }

            {/* Categories Modal */}
            {
                isCategoriesModalOpen && (
                    <CategoriesModal
                        categories={categories}
                        onClose={() => setIsCategoriesModalOpen(false)}
                        onAdd={handleAddCategory}
                        onEdit={handleEditCategory}
                        onDelete={handleDeleteCategory}
                    />
                )
            }

            {/* Custom Confirmation Modal */}
            {
                confirmState && (
                    <ConfirmModal
                        title={confirmState.title}
                        message={confirmState.message}
                        confirmText={confirmState.confirmText}
                        onConfirm={confirmState.onConfirm}
                        onCancel={() => setConfirmState(null)}
                    />
                )
            }

            {/* Toast — handles swipe-delete undo AND draft restore after failed save */}
            {toast && (
                <Toast
                    message={toast.message}
                    duration={toast.draft ? 12000 : 5000}
                    onUndo={
                        toast.draft
                            ? () => {
                                // Restore the lost draft into the editor
                                setEditingNote(toast.draft);
                                setIsEditorOpen(true);
                                localStorage.removeItem(DRAFT_KEY);
                              }
                            : toast.noteData
                                ? handleUndoDelete
                                : undefined
                    }
                    actionLabel={toast.draft ? 'Restore' : 'Undo'}
                    onDismiss={() => setToast(null)}
                />
            )}
        </div >
    );
}
