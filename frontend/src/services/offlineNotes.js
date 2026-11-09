import { clearPageCache } from './pageCache';

// Private note bodies live in IndexedDB, never in the service worker's HTTP cache.
const DB_NAME = 'second-brain-offline';
const STORE = 'snapshots';
const SCOPE_KEY = 'sb_offline_scope';
// The token a silent renewal just replaced: same session, so requests and
// drafts started with it still count as current.
const PREVIOUS_TOKEN_KEY = 'sb_previous_token';
export const SESSION_EVENT = 'second-brain:session';
export const NOTES_CHANGED_EVENT = 'second-brain:notes-changed';
export const CONNECTION_EVENT = 'second-brain:connection';
let unavailable = false;

export function tokenSubject(token) {
    try {
        const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
        return typeof payload.sub === 'string' ? payload.sub : null;
    } catch { return null; }
}

export function isCurrentToken(token) {
    return !!token && (token === localStorage.getItem('token') ||
        token === localStorage.getItem(PREVIOUS_TOKEN_KEY));
}

// Swap in a renewed JWT without ending the session: the offline scope (keyed by
// subject) and its saved notes stay. No-op if the session changed meanwhile.
export function renewSession(oldToken, newToken) {
    if (localStorage.getItem('token') !== oldToken || !newToken ||
        tokenSubject(newToken) !== tokenSubject(oldToken)) return false;
    localStorage.setItem(PREVIOUS_TOKEN_KEY, oldToken);
    localStorage.setItem('token', newToken);
    window.dispatchEvent(new Event(SESSION_EVENT));
    return true;
}

export function isOfflineReading() {
    return navigator.onLine === false || unavailable;
}

export function setConnectionUnavailable(value) {
    if (unavailable === value) return;
    unavailable = value;
    window.dispatchEvent(new Event(CONNECTION_EVENT));
}

function scopeFor(token, create = false) {
    const subject = tokenSubject(token);
    if (!subject || !isCurrentToken(token)) return null;
    let scope;
    try { scope = JSON.parse(localStorage.getItem(SCOPE_KEY)); } catch { /* missing */ }
    if (scope?.subject === subject && scope.key) return scope.key;
    if (!create) return null;
    const key = crypto.randomUUID();
    localStorage.setItem(SCOPE_KEY, JSON.stringify({ subject, key }));
    return key;
}

export function hasOfflineScope(token) {
    return !!scopeFor(token);
}

function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Offline storage is blocked'));
    });
}

async function transaction(mode, action) {
    const db = await openDatabase();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            let result;
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('Offline storage unavailable'));
            action(tx.objectStore(STORE), value => { result = value; });
        });
    } finally { db.close(); }
}

export async function readOfflineSnapshot(token) {
    const key = scopeFor(token);
    if (!key) return null;
    const snapshot = await transaction('readonly', (store, done) => {
        store.get(key).onsuccess = event => done(event.target.result || null);
    });
    return scopeFor(token) === key ? snapshot : null;
}

export async function saveOfflineSnapshot(token, snapshot, isCurrent = () => true) {
    const key = scopeFor(token, true);
    if (!key) return false;
    return transaction('readwrite', (store, done) => {
        // Recheck after opening IDB: logout/account changes may happen while awaiting it.
        if (scopeFor(token) !== key || !isCurrent()) { done(false); return; }
        store.put(snapshot, key);
        done(true);
    });
}

export function clearSession() {
    // Revoke access synchronously, even if the browser denies a storage deletion.
    localStorage.removeItem('token');
    localStorage.removeItem(PREVIOUS_TOKEN_KEY);
    localStorage.removeItem(SCOPE_KEY);
    localStorage.removeItem('sb_pending_draft');
    clearPageCache();
    unavailable = false;
    window.dispatchEvent(new Event(SESSION_EVENT));
    return transaction('readwrite', store => store.clear()).catch(() => {});
}

export async function startSession(token) {
    await clearSession();
    localStorage.setItem('token', token);
    window.dispatchEvent(new Event(SESSION_EVENT));
}

// Reflect acknowledged writes immediately, including deletions. A subsequent full
// refresh reconciles other-device changes. Never persist an optimistic UI update.
export async function updateOfflineSnapshot(config, data) {
    const token = config.offlineToken;
    const key = scopeFor(token);
    if (!key) return;
    const path = config.url.split('?')[0];
    const match = path.match(/^\/notes\/([^/]+)(?:\/(restore|permanent))?$/);
    const method = config.method?.toLowerCase();
    if (!((path === '/notes' || match) && ['post', 'put', 'delete'].includes(method))) return;
    await transaction('readwrite', store => {
        if (scopeFor(token) !== key) return;
        store.get(key).onsuccess = event => {
            const snapshot = event.target.result;
            if (!snapshot || scopeFor(token) !== key) return;
            const id = data?.id || match?.[1];
            let notes = snapshot.notes.filter(note => note.id !== id);
            if (method !== 'delete' && data?.id && typeof data.content === 'string') {
                notes = [data, ...notes];
            } else if (method !== 'delete') {
                return; // response without a body: wait for the full refresh
            }
            store.put({ ...snapshot, notes }, key);
        };
    });
}

export function searchableNoteText(note) {
    const doc = new DOMParser().parseFromString(note.content || '', 'text/html');
    return `${note.title || ''}\n${doc.body.textContent || ''}`.toLocaleLowerCase();
}
