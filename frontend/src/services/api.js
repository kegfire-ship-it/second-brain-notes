import axios from 'axios';
import { clearSession, hasOfflineScope, isCurrentToken, isOfflineReading, NOTES_CHANGED_EVENT, updateOfflineSnapshot } from './offlineNotes';

// The base URL will point to our FastAPI backend
const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
    baseURL: API_URL,
});

// Decode JWT payload and check if the token is expired (no library needed — payload is just base64)
const isTokenExpired = (token) => {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp * 1000 < Date.now();
    } catch {
        return true; // malformed token = treat as expired
    }
};

const kickToLogin = () => {
    clearSession();
    window.location.href = '/login';
};

// A cached session can keep reading through a connection failure, even after
// token expiry. Only an actual server rejection revokes that local copy.
api.interceptors.request.use(
    (config) => {
        if (navigator.onLine === false || (isOfflineReading() && !['get', 'head'].includes(config.method))) {
            return Promise.reject(Object.assign(new Error('Notes are read-only while offline'), { code: 'OFFLINE' }));
        }
        const token = localStorage.getItem('token');
        if (token) {
            if (isTokenExpired(token) && !hasOfflineScope(token)) {
                kickToLogin();
                return Promise.reject(Object.assign(new Error('Token expired'), { code: 'AUTH_EXPIRED' }));
            }
            // Wi-Fi can be connected without internet. For a saved session let
            // authenticated reads reach the server: a real 401 proves rejection,
            // a network error must retain the offline copy. Expired writes stop.
            if (isTokenExpired(token) && !['get', 'head'].includes(config.method)) {
                return Promise.reject(Object.assign(new Error('Token expired'), { code: 'AUTH_EXPIRED' }));
            }
            config.headers.Authorization = `Bearer ${token}`;
            config.offlineToken = token;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// Response interceptor — handle expired/invalid JWT globally
// When the server returns 401, the token is gone or expired.
// Clear it and redirect to /login so the user can re-authenticate.
api.interceptors.response.use(
    async (response) => {
        const { config, data } = response;
        if (isCurrentToken(config.offlineToken) &&
            ['post', 'put', 'patch', 'delete'].includes(config.method) &&
            /^\/(notes|categories)(\/|$)/.test(config.url)) {
            window.dispatchEvent(new Event(NOTES_CHANGED_EVENT));
            // A storage failure must never turn a successful server save into a failure.
            await updateOfflineSnapshot(config, data).catch(() => {});
        }
        return response;
    },
    (error) => {
        if (error.response?.status === 401 && isCurrentToken(error.config?.offlineToken)) {
            clearSession();
            // Hard redirect — clears all React state cleanly
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default api;
