import { htmlToText, looksLikeHtml } from './richText';

// Preview links include channels, playlists and other YouTube pages, not only
// video IDs. Keep video extraction's stricter URL rules separate.
function youtubeHref(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
        return ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(url.hostname)
            ? url.href : null;
    } catch { return null; }
}

/** Readable preview segments; stored HTML is never changed or rendered. */
export function notePreview(content) {
    const source = String(content ?? '');
    const destinations = new Map();
    let previewHtml = source;
    let marker = '\uE000';

    if (looksLikeHtml(source)) {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        // Avoid collisions with literal note text, including encoded characters.
        while (source.includes(marker) || doc.body.textContent.includes(marker)) marker += '\uE000';
        for (const anchor of doc.querySelectorAll('a[href]')) {
            const href = youtubeHref(anchor.getAttribute('href'));
            if (!href) continue;
            const token = `${marker}${destinations.size}\uE001`;
            destinations.set(token, href);
            anchor.replaceWith(doc.createTextNode(token));
        }
        if (destinations.size) previewHtml = doc.body.innerHTML;
    }

    // Split anchor tokens first so an adjacent bare URL cannot swallow them.
    return htmlToText(previewHtml).split(new RegExp(`(${marker}\\d+\uE001)`, 'g')).flatMap(part => {
        if (destinations.has(part)) return [{ href: destinations.get(part), youtube: true }];
        return part.split(/(https?:\/\/[^\s<>"']+)/gi).flatMap((text, index) => {
            if (index % 2 === 0) return text ? [{ text }] : [];
            const punctuation = text.match(/[.,;:!?)\]}»…]+$/)?.[0] || '';
            const href = youtubeHref(punctuation ? text.slice(0, -punctuation.length) : text);
            if (!href) return [{ href: text, text }];
            return [{ href, youtube: true }, ...(punctuation ? [{ text: punctuation }] : [])];
        });
    });
}
