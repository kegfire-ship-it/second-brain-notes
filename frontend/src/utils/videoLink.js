export function safeYouTubeUrl(value) {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
        const host = url.hostname.toLowerCase();
        let id;
        if (host === 'youtu.be') id = url.pathname.slice(1);
        else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
            id = url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
        }
        return id && /^[\w-]{11}$/.test(id) ? url.href : null;
    } catch { return null; }
}

export function safeInstagramUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
            && ['instagram.com', 'www.instagram.com'].includes(url.hostname.toLowerCase())
            && /^\/(?:reel|reels|p)\/[^/]+/.test(url.pathname) ? url.href : null;
    } catch { return null; }
}

// Any video link the extraction supports: YouTube or an Instagram reel/post.
export function safeVideoUrl(value) {
    return safeYouTubeUrl(value) || safeInstagramUrl(value);
}

export function paragraphVideoUrl(node) {
    let found = null;
    node.descendants(child => {
        if (found) return false;
        found = child.marks?.map(mark => mark.type.name === 'link' && safeVideoUrl(mark.attrs.href)).find(Boolean) || null;
    });
    return found || (node.textContent.match(/https?:\/\/[^\s<>"']+/g) || []).map(safeVideoUrl).find(Boolean) || null;
}

export function videoUrlFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('a')].map(a => safeYouTubeUrl(a.getAttribute('href'))).find(Boolean)
        || (doc.body.textContent.match(/https?:\/\/[^\s<>"']+/g) || []).map(safeYouTubeUrl).find(Boolean) || null;
}

export function instagramUrlFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return [...doc.querySelectorAll('a')].map(a => safeInstagramUrl(a.getAttribute('href'))).find(Boolean)
        || (doc.body.textContent.match(/https?:\/\/[^\s<>"']+/g) || []).map(safeInstagramUrl).find(Boolean) || null;
}
