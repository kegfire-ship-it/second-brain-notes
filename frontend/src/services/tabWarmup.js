import api from './api';

export const NOTES_PAGE_SIZE = 50;

// The notes grid's first paint: every pinned note + the first page of others.
export async function fetchNotesFirstPage() {
  const [pinned, others] = await Promise.all([
    api.get('/notes', { params: { pinned: true } }),
    api.get('/notes', { params: { pinned: false, limit: NOTES_PAGE_SIZE } }),
  ]);
  return {
    pinnedNotes: pinned.data,
    otherNotes: others.data,
    otherCursor: others.data.length ? others.data[others.data.length - 1].id : null,
    hasMore: others.data.length === NOTES_PAGE_SIZE,
  };
}
