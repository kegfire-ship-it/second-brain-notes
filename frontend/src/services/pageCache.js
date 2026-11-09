import { useEffect, useRef, useState } from 'react';

// Last-seen data of the main tabs, kept in memory for the life of the page.
// A tab paints instantly from what it showed last time while it refetches in
// the background (stale-while-revalidate), instead of flashing its empty
// state on every switch. Never persisted; cleared on logout (clearSession).
const store = new Map();
const CHANGED = Symbol('changed');

export const CACHE_KEYS = {
  notes: 'notes:first-page',         // { pinnedNotes, otherNotes, otherCursor, hasMore }
  noteCategories: 'notes:categories',
  activeTasks: 'tasks:active',       // unfiltered active tasks (panel + tasks page)
  todoistProjects: 'tasks:projects',
  goals: 'goals:current',
  goalCategories: 'goals:categories',
  achievements: 'goals:achievements',
  contextProjects: 'context-projects',
  archivedProjects: 'context-projects:archived',
  mindmaps: 'mindmaps',
};

// One opened project page (/projects/:id), keyed by context-project id.
export const PROJECT_KEYS = {
  project: (id) => `project:${id}`,          // project dict incl. hydrated notes
  map: (id) => `project:${id}:map`,          // full map payload, or null = no map
  journal: (id) => `project:${id}:journal`,  // journal entries
};

export const peek = (key) => store.get(key);
export const has = (key) => store.has(key);
export const remember = (key, value) => { store.set(key, value); };
export const clearPageCache = () => { store.clear(); };

// useState that starts from the cached value and writes every change back.
// The starting value itself is not written, so a cold mount leaves the key
// empty for the background warm-up (services/tabWarmup.js) to fill.
export function useCachedState(key, initial) {
  const [value, setValue] = useState(() => (store.has(key) ? store.get(key) : initial));
  const startedFrom = useRef(value);
  useEffect(() => {
    if (value === startedFrom.current) return;
    startedFrom.current = CHANGED;   // from here on every value is written
    store.set(key, value);
  }, [key, value]);
  return [value, setValue];
}
