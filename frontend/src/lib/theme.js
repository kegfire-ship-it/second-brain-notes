import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

// App color theme: the user's choice ('light' | 'dark' | 'system') lives in
// localStorage per device; the RESOLVED theme is the `dark` class on <html>.
// index.html runs the same resolution inline before first paint (no white
// flash) — keep THEME_KEY and the class name in sync with that script.

export const THEME_KEY = 'sb-theme';
export const THEMES = ['light', 'dark', 'system'];

// Browser chrome (iOS status bar, Android toolbar) matches the page background.
const THEME_COLOR = { light: '#ffffff', dark: '#0f1318' };

const listeners = new Set();
const media = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null;

function readChoice() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : 'light';
  } catch {
    return 'light';
  }
}

let choice = readChoice();

export function resolveTheme(theme, systemDark = !!media?.matches) {
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme === 'dark' ? 'dark' : 'light';
}

function apply() {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(choice);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLOR[resolved]);
}

function emit() {
  apply();
  listeners.forEach((fn) => fn());
}

// Every component animates its colors at its own speed (150ms, 200ms, none) —
// flipping the tokens under them made the page repaint in patches. So for the
// frame the theme flips, `.theme-switching` (index.css) turns ALL transitions
// off; the change itself is then one deliberate animation (see setTheme).
function flipWithoutTransitions() {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  // React-driven colors (goal tints, map, login) must land in the same frame.
  flushSync(emit);
  void window.getComputedStyle(root).color; // commit styles with transitions off
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.classList.remove('theme-switching');
  }));
}

function reducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function getTheme() {
  return choice;
}

/**
 * Switch the theme. When the visible theme actually changes, the new look
 * fades in over a still picture of the old one (View Transitions; timing in
 * index.css) — the whole page moves as one, nothing flickers on its own.
 * No support or «reduce motion» → an instant, clean swap.
 */
export function setTheme(next) {
  if (!THEMES.includes(next)) return;
  const before = resolveTheme(choice);
  choice = next;
  try { localStorage.setItem(THEME_KEY, next); } catch { /* private mode */ }
  if (typeof document === 'undefined') return;

  const changesLook = resolveTheme(choice) !== before;
  if (!changesLook || !document.startViewTransition || reducedMotion()) {
    flipWithoutTransitions();
    return;
  }
  let flipped = false;
  const vt = document.startViewTransition(() => {
    flipped = true;
    flipWithoutTransitions();
  });
  // The browser runs the swap on its next rendered frame — a hidden or busy
  // tab may never get one. Never leave the theme unapplied: give up on the
  // animation and switch right away.
  setTimeout(() => {
    if (flipped) return;
    vt.skipTransition();
    flipWithoutTransitions();
  }, 250);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = () => `${choice}:${resolveTheme(choice)}`;

/** { theme: user choice, resolved: 'light' | 'dark', setTheme } — re-renders on change. */
export function useTheme() {
  const snap = useSyncExternalStore(subscribe, snapshot, () => 'light:light');
  const [theme, resolved] = snap.split(':');
  return { theme, resolved, setTheme };
}

apply();
