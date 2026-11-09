import api from './api';
import { isOfflineReading, renewSession } from './offlineNotes';

// Sessions last 2 weeks (backend ACCESS_TOKEN_EXPIRE_MINUTES) and are renewed
// while the app is in use, at most about once a day: a token with more than
// 13 days left is fresh enough. So you only sign in again after 2 weeks away.
const RENEW_WHEN_LESS_THAN_MS = 13 * 24 * 60 * 60 * 1000;

let inFlight = null;

function expiresAt(token) {
    try {
        const encoded = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        const { exp } = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
        return typeof exp === 'number' ? exp * 1000 : null;
    } catch { return null; }
}

export function renewSessionIfDue(now = Date.now()) {
    if (inFlight) return inFlight;
    const token = localStorage.getItem('token');
    const exp = token && expiresAt(token);
    // Expired tokens keep their existing path (offline reading, then /login).
    if (!exp || exp <= now || exp - now > RENEW_WHEN_LESS_THAN_MS || isOfflineReading()) {
        return Promise.resolve(false);
    }
    inFlight = api.post('/auth/refresh', null, { timeout: 10000 })
        .then(({ data }) => renewSession(token, data?.access_token))
        // Best effort: a network failure leaves the current token as it is; a
        // real 401 is already handled by api's response interceptor (→ /login).
        .catch(() => false)
        .finally(() => { inFlight = null; });
    return inFlight;
}

// On app start and whenever the app comes back to the screen (a home-screen
// app can stay open in the background for days without reloading).
export function startSessionRenewal() {
    renewSessionIfDue();
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') renewSessionIfDue();
    });
}
