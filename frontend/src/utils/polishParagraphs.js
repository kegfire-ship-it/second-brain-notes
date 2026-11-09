// Convert plain text (paragraphs separated by blank lines, or single newlines
// as a fallback) into escaped <p> HTML for TipTap insertContentAt.
const escapeHtml = (s) =>
    s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function textToParagraphs(text) {
    if (!text || !text.trim()) return '';
    let parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) {
        parts = text.split(/\n/).map((p) => p.trim()).filter(Boolean);
    }
    if (parts.length === 0) return '';
    return parts.map((p) => `<p>${escapeHtml(p)}</p>`).join('');
}
