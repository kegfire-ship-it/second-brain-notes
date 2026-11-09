// Helpers for the project goal / description rich-text fields.
//
// Goal/description used to be plain text; they now store HTML (TipTap output:
// <p>, <strong>, <em>, <ul>/<li>). These helpers bridge the two worlds:
//   - plainTextToHtml — seed legacy plain-text values into the editor / read view
//   - isHtmlEmpty     — treat an empty doc (<p></p>) as truly empty
//   - htmlToText      — strip markup back to readable text for plain previews

const HAS_TAG = /<[a-z!/][^>]*>/i;

/** True when the string already contains HTML markup (vs legacy plain text). */
export const looksLikeHtml = (s) => HAS_TAG.test(s || '');

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Normalise a stored value into HTML safe to feed TipTap or render directly.
 * Already-HTML values pass through untouched; legacy plain text is escaped and
 * gets its line breaks preserved (blank line → new paragraph, single \n → <br>).
 * Empty / whitespace-only input returns '' (the editor seeds an empty doc).
 */
export function plainTextToHtml(value) {
  const v = (value ?? '').toString();
  if (!v.trim()) return '';
  if (looksLikeHtml(v)) return v;
  return v
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** True when HTML carries no visible text (e.g. TipTap's empty `<p></p>`). */
export const isHtmlEmpty = (html) =>
  !html || html.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim().length === 0;

// Bare-URL matcher for linkifying plain text: http(s):// or www. up to the next
// whitespace / tag boundary. Trailing sentence punctuation is trimmed back out
// of the link (kept as text) so "…at https://x.com." doesn't swallow the dot.
const BARE_URL_RE = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}»"'…]+$/;

const linkLabelFor = (href) => {
  try {
    return new URL(href).hostname.replace(/^www\./iu, '') || href;
  } catch {
    return href;
  }
};

/**
 * Returns a clean Link-mark payload only when the clipboard contains one
 * standalone web address. Pasted rich HTML from browsers, Google Keep, etc.
 * can include link-preview nodes that are useless in a note and are fragile
 * when copied into other apps. Replacing that payload with a tiny anchor keeps
 * the destination but gives the clipboard a simple, predictable shape.
 */
export function sanitiseStandalonePastedLink(text) {
  const source = String(text ?? '').trim();
  if (!/^(?:https?:\/\/|www\.)[^\s<>]+$/iu.test(source)) return null;

  const trailing = (source.match(TRAILING_PUNCT_RE) || [''])[0];
  const rawUrl = trailing ? source.slice(0, source.length - trailing.length) : source;
  const href = /^www\./iu.test(rawUrl) ? `https://${rawUrl}` : rawUrl;

  try {
    const parsed = new URL(href);
    if (!/^https?:$/iu.test(parsed.protocol) || !parsed.hostname) return null;
    return { href, label: rawUrl };
  } catch {
    return null;
  }
}

/**
 * Replace one pasted URL with a full-address Link mark before TipTap can import an
 * external source's HTML preview. Returns whether the paste was handled.
 */
export function insertSanitisedPastedLink(event, editor) {
  const link = sanitiseStandalonePastedLink(event.clipboardData?.getData('text/plain'));
  if (!link || !editor) return false;

  event.preventDefault();
  editor.chain().focus().insertContent({
    type: 'text',
    text: link.label,
    marks: [{ type: 'link', attrs: { href: link.href } }],
  }).run();
  return true;
}

/** Display state for URL labels; custom link titles are left alone. */
export function getLinkDisplay(href, label, expandedLabel = null) {
  if (!/^https?:\/\//iu.test(href || '')) return null;
  const compact = linkLabelFor(href);
  const withoutProtocol = href.replace(/^https?:\/\//iu, '');
  if (expandedLabel && label === compact && (expandedLabel === href || expandedLabel === withoutProtocol)) {
    return { collapsed: true, expandedLabel, compact };
  }
  if (label === href || label === withoutProtocol) {
    if (label === compact) return null;
    return { collapsed: false, expandedLabel: label, compact };
  }
  // Older versions saved only the hostname as the label. The href still
  // contains the full destination, so those links can be expanded too.
  if (label === compact) return { collapsed: true, expandedLabel: href, compact };
  return null;
}

/**
 * Wrap bare URLs in an HTML string's text with clickable <a> tags, so a plain
 * link typed into the goal/description renders clickable even for values saved
 * before links were supported. URLs already inside an <a> are left untouched
 * (no double-wrapping); tags and other markup pass through verbatim. The output
 * feeds straight into TipTap, which restyles the anchor via its Link mark.
 * `www.` links get an https:// href. Blank input returns ''.
 */
export function linkifyHtml(html) {
  const s = (html ?? '').toString();
  if (!s) return '';
  let insideAnchor = 0;
  const linked = s
    .split(/(<[^>]+>)/)
    .map((tok) => {
      if (!tok) return tok;
      if (tok[0] === '<') {
        if (/^<a(\s|>|\/)/i.test(tok)) insideAnchor += 1;
        else if (/^<\/a\s*>/i.test(tok)) insideAnchor = Math.max(0, insideAnchor - 1);
        return tok; // a tag itself is never linkified
      }
      if (insideAnchor > 0) return tok; // text already inside a link — leave it
      return tok.replace(BARE_URL_RE, (match) => {
        const trail = (match.match(TRAILING_PUNCT_RE) || [''])[0];
        const url = trail ? match.slice(0, match.length - trail.length) : match;
        const href = /^www\./i.test(url) ? `https://${url}` : url;
        return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>${trail}`;
      });
    })
    .join('');
  return linked;
}

/**
 * One stored line = one paragraph. Lines joined by <br> inside a single <p>
 * (Keep imports, Shift+Enter) become separate paragraphs, so a video card or a
 * link description lands right under its own line instead of under the whole
 * block. Paragraphs carry no margin, so the note looks the same either way.
 */
export function splitParagraphLines(html) {
  const s = (html ?? '').toString();
  if (!/<br/i.test(s) || typeof DOMParser === 'undefined') return s;
  const doc = new DOMParser().parseFromString(s, 'text/html');
  let changed = false;
  for (const paragraph of [...doc.body.children]) {
    if (paragraph.tagName !== 'P' || paragraph.attributes.length) continue;
    const children = [...paragraph.childNodes];
    if (!children.some((node) => node.nodeName === 'BR')) continue;
    const lines = [[]];
    for (const node of children) {
      if (node.nodeName === 'BR') lines.push([]);
      else lines[lines.length - 1].push(node);
    }
    // A trailing <br> draws no extra line in the browser.
    if (!lines[lines.length - 1].length) lines.pop();
    paragraph.replaceWith(...lines.map((nodes) => {
      const line = doc.createElement('p');
      line.append(...nodes);
      return line;
    }));
    changed = true;
  }
  return changed ? doc.body.innerHTML : s;
}

const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&'); // amp last so decoded text isn’t re-decoded

/**
 * HTML → readable plain text, block-aware: keeps line breaks and bullets so a
 * formatted goal still reads well in a clamped card / panel preview.
 */
export function htmlToText(html) {
  if (!html) return '';
  const text = String(html)
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
