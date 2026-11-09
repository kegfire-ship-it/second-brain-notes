import { useEffect, useRef, useState } from 'react';
import api from '../services/api';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LEN = 3;

const stripHtml = (html) => (html || '').replace(/<[^>]*>/g, '');

const splitAndShape = (notes) => {
    const pinned = [];
    const other = [];
    for (const n of notes) {
        if (n.pinned) pinned.push(n);
        else other.push(n);
    }
    pinned.sort((a, b) => (b.position || 0) - (a.position || 0));
    // backend already orders unpinned; preserve.
    return { pinned, other, total: notes.length };
};

const fallbackFilter = (pool, q) => {
    const ql = q.toLowerCase();
    return pool.filter((n) => {
        const title = (n.title || '').toLowerCase();
        const content = stripHtml(n.content).toLowerCase();
        return title.includes(ql) || content.includes(ql);
    });
};

export default function useNoteSearch(query, fallbackPool) {
    const [results, setResults] = useState(null);
    const [status, setStatus] = useState('idle');
    const abortRef = useRef(null);

    useEffect(() => {
        // Below threshold → reset to browse mode.
        if (!query || query.length < MIN_QUERY_LEN) {
            if (abortRef.current) abortRef.current.abort();
            setResults(null);
            setStatus('idle');
            return;
        }

        const timer = setTimeout(async () => {
            // Cancel any prior in-flight request before starting a new one.
            if (abortRef.current) abortRef.current.abort();
            const controller = new AbortController();
            abortRef.current = controller;
            setStatus('loading');

            try {
                const { data } = await api.get('/search', {
                    params: { q: query },
                    signal: controller.signal,
                });
                if (controller.signal.aborted) return;
                setResults(splitAndShape(data));
                setStatus('idle');
            } catch (err) {
                if (controller.signal.aborted || err.name === 'CanceledError'
                    || err.code === 'ERR_CANCELED') {
                    return; // expected on retype
                }
                // Graceful degradation: filter the already-loaded pool.
                const filtered = fallbackFilter(fallbackPool, query);
                setResults(splitAndShape(filtered));
                setStatus('fallback');
            }
        }, DEBOUNCE_MS);

        return () => clearTimeout(timer);
    // fallbackPool deliberately omitted from deps: it changes on every parent
    // render and would cause unnecessary refetches. We only re-fetch on query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query]);

    return { results, status };
}
