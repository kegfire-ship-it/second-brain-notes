import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../services/api';
import {
    CONNECTION_EVENT, NOTES_CHANGED_EVENT, SESSION_EVENT, isCurrentToken, isOfflineReading,
    readOfflineSnapshot, saveOfflineSnapshot, setConnectionUnavailable,
} from '../services/offlineNotes';

export default function useOfflineNotes() {
    const [token, setToken] = useState(() => localStorage.getItem('token'));
    const [offline, setOffline] = useState(isOfflineReading);
    const [savedState, setSavedState] = useState(null);
    const [status, setStatus] = useState('loading');
    const refreshRef = useRef(() => {});

    useEffect(() => {
        const session = () => setToken(localStorage.getItem('token'));
        const connection = () => setOffline(isOfflineReading());
        window.addEventListener(SESSION_EVENT, session);
        window.addEventListener('storage', session);
        window.addEventListener('offline', connection);
        window.addEventListener(CONNECTION_EVENT, connection);
        return () => {
            window.removeEventListener(SESSION_EVENT, session);
            window.removeEventListener('storage', session);
            window.removeEventListener('offline', connection);
            window.removeEventListener(CONNECTION_EVENT, connection);
        };
    }, []);

    useEffect(() => {
        let disposed = false;
        let generation = 0;
        let timer;
        let controller;
        const current = () => !disposed && isCurrentToken(token);
        const setSnapshot = value => setSavedState({ token, value });
        const loadSaved = async () => {
            try {
                const saved = await readOfflineSnapshot(token);
                if (current()) { setSnapshot(saved); setStatus(saved ? 'saved' : 'empty'); }
            } catch { if (current()) setStatus('storage-error'); }
        };

        const refresh = async () => {
            if (!token || !current()) return;
            controller?.abort();
            const version = ++generation;
            if (navigator.onLine === false) { await loadSaved(); return; }
            controller = new AbortController();
            setStatus('syncing');
            try {
                // No limit: offline search must include notes beyond the visible first page.
                const config = { timeout: 15000, signal: controller.signal };
                const [pinned, other] = await Promise.all([
                    api.get('/notes', { ...config, params: { pinned: true } }),
                    api.get('/notes', { ...config, params: { pinned: false } }),
                ]);
                if (!current() || version !== generation) return;
                if (![pinned.data, other.data].every(data => Array.isArray(data) && data.every(note => typeof note.id === 'string' && typeof note.content === 'string'))) throw new Error('Invalid notes response');
                const notes = [...new Map([...pinned.data, ...other.data].map(n => [n.id, n])).values()];
                const next = { notes, savedAt: new Date().toISOString() };
                // IDB quota/failure is distinct from network availability.
                try {
                    const saved = await saveOfflineSnapshot(token, next, () => current() && version === generation);
                    if (!current() || version !== generation) return;
                    if (saved) { setSnapshot(next); setStatus('saved'); }
                } catch { if (current()) setStatus('storage-error'); }
                if (current()) {
                    setConnectionUnavailable(false);
                    setOffline(false);
                }
            } catch (error) {
                if (!current() || version !== generation || error.code === 'ERR_CANCELED') return;
                await loadSaved();
                if (!current() || version !== generation) return;
                setStatus('sync-error');
                // HTTP errors are not offline; authentication still obeys the server.
                if (!error.response && error.code !== 'AUTH_EXPIRED') {
                    setConnectionUnavailable(true);
                    setOffline(true);
                }
            }
        };
        refreshRef.current = refresh;
        const schedule = () => {
            // Invalidate older in-flight full snapshots before a just-acknowledged edit.
            generation++;
            controller?.abort();
            clearTimeout(timer);
            timer = setTimeout(refresh, 300);
        };
        const visible = () => { if (document.visibilityState === 'visible') refresh(); };
        const start = async () => {
            setSnapshot(null);
            setStatus('loading');
            await loadSaved();
            if (current()) refresh();
        };
        start();
        window.addEventListener('online', refresh);
        window.addEventListener('offline', refresh);
        window.addEventListener('focus', visible);
        window.addEventListener(NOTES_CHANGED_EVENT, schedule);
        document.addEventListener('visibilitychange', visible);
        return () => {
            disposed = true;
            controller?.abort();
            clearTimeout(timer);
            window.removeEventListener('online', refresh);
            window.removeEventListener('offline', refresh);
            window.removeEventListener('focus', visible);
            window.removeEventListener(NOTES_CHANGED_EVENT, schedule);
            document.removeEventListener('visibilitychange', visible);
        };
    }, [token]);

    const refresh = useCallback(() => refreshRef.current(), []);
    return { token, offline, snapshot: savedState?.token === token ? savedState.value : null, status, refresh };
}
