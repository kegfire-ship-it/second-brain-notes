// Clipboard helpers for the app's plain-text fields (mind-map nodes and
// project branches). They intentionally clean incoming pasted text only.
// Rich text sent *out* of the app is handled in richCopy.js and keeps its
// original HTML, including intentional blank paragraphs.
//
// DOM-based (DOMParser) so it works in both jsdom (tests) and the browser.

const BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'DIV', 'PRE']);

const parse = (html) => new DOMParser().parseFromString(String(html || ''), 'text/html');

/** Inline text of a node: BR → newline, nested lists skipped (handled by caller). */
function inlineText(node) {
  let out = '';
  node.childNodes.forEach((c) => {
    if (c.nodeType === 3) {
      out += c.textContent;
    } else if (c.nodeType === 1) {
      const tag = c.tagName;
      if (tag === 'BR') out += '\n';
      else if (tag === 'UL' || tag === 'OL') { /* nested list — caller recurses */ }
      else out += inlineText(c);
    }
  });
  return out;
}

/** Normalise a block's inline text: collapse spaces, drop blank lines from <br><br>. */
function tidyBlock(s) {
  return s
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
}

function processList(listEl, depth, out) {
  const ordered = listEl.tagName === 'OL';
  let n = 1;
  Array.from(listEl.children).forEach((li) => {
    if (li.tagName !== 'LI') return;
    const marker = ordered ? `${n++}. ` : '- ';
    const indent = '  '.repeat(depth);
    const txt = tidyBlock(inlineText(li));
    if (txt) {
      const lines = txt.split('\n');
      out.push(indent + marker + lines[0]);
      for (let i = 1; i < lines.length; i++) out.push(indent + '  ' + lines[i]);
    }
    // nested lists inside this <li>
    Array.from(li.children).forEach((ch) => {
      if (ch.tagName === 'UL' || ch.tagName === 'OL') processList(ch, depth + 1, out);
    });
  });
}

function walk(root, out) {
  Array.from(root.childNodes).forEach((c) => {
    if (c.nodeType === 3) {
      const t = c.textContent.replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
      return;
    }
    if (c.nodeType !== 1) return;
    const tag = c.tagName;
    if (tag === 'UL' || tag === 'OL') {
      processList(c, 0, out);
    } else if (BLOCK.has(tag)) {
      const txt = tidyBlock(inlineText(c));
      if (txt) txt.split('\n').forEach((l) => out.push(l));
    } else {
      // unknown wrapper (e.g. a span/strong at top level) — take its text
      const txt = tidyBlock(inlineText(c));
      if (txt) txt.split('\n').forEach((l) => out.push(l));
    }
  });
}

/** HTML (string or fragment markup) → tidy plain text, no blank-line gaps. */
export function htmlToCleanText(html) {
  if (!html) return '';
  const out = [];
  walk(parse(html).body, out);
  return out.join('\n');
}

/**
 * A text/plain fallback for rich copy. Unlike htmlToCleanText, this preserves
 * blank block elements: `<p>one</p><p></p><p>two</p>` becomes `one\n\ntwo`.
 * The rich `text/html` payload remains the source of truth for destinations
 * that support formatting.
 */
function preserveBlockBreaks(text) {
  const lines = String(text || '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim());

  // TipTap marks an empty paragraph with a trailing <br>. It represents the
  // paragraph itself, not an additional blank line after it.
  while (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines.join('\n');
}

function processClipboardList(listEl, depth, out) {
  const ordered = listEl.tagName === 'OL';
  let n = 1;

  Array.from(listEl.children).forEach((li) => {
    if (li.tagName !== 'LI') return;
    const marker = ordered ? `${n++}. ` : '- ';
    const indent = '  '.repeat(depth);
    const text = preserveBlockBreaks(inlineText(li));

    if (text) {
      const lines = text.split('\n');
      out.push(indent + marker + lines[0]);
      for (let i = 1; i < lines.length; i += 1) out.push(indent + '  ' + lines[i]);
    }

    Array.from(li.children).forEach((child) => {
      if (child.tagName === 'UL' || child.tagName === 'OL') processClipboardList(child, depth + 1, out);
    });
  });
}

function walkForClipboard(root, out) {
  Array.from(root.childNodes).forEach((child) => {
    if (child.nodeType === 3) {
      const text = preserveBlockBreaks(child.textContent);
      if (text) out.push(text);
      return;
    }
    if (child.nodeType !== 1) return;

    if (child.tagName === 'UL' || child.tagName === 'OL') {
      processClipboardList(child, 0, out);
      return;
    }

    const text = preserveBlockBreaks(inlineText(child));
    if (BLOCK.has(child.tagName)) {
      // Push even an empty block so intentional paragraph spacing survives.
      out.push(text);
    } else if (text) {
      out.push(text);
    }
  });
}

export function htmlToClipboardText(html) {
  if (!html) return '';
  const out = [];
  walkForClipboard(parse(html).body, out);
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

// ---------------------------------------------------------------------------
// Paste side. The mirror problem: pasting note content INTO a plain-text field
// (a project branch / mindmap node) inserts the clipboard's gappy text verbatim
// — copying a note serialises its block structure into runs of blank lines, so
// the node ends up with huge gaps between rows.

/** Collapse blank-line runs (and trailing spaces) in plain text — no big gaps. */
export function normalizePastedText(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')        // CRLF → LF
    .replace(/\u00a0/g, ' ')         // nbsp → space
    .replace(/[ \t]+\n/g, '\n')      // strip trailing spaces before a newline
    .replace(/\n{2,}/g, '\n')        // collapse blank-line runs to a single break
    .replace(/[ \t]{2,}/g, ' ')      // collapse runs of spaces
    .trim();
}

/**
 * Best tidy plain text for pasting into a node/branch from a clipboard event's
 * DataTransfer. Prefer the rich `text/html` (→ bulleted, indented, gap-free
 * outline via htmlToCleanText); fall back to normalised `text/plain`.
 */
export function cleanTextFromClipboard(dataTransfer) {
  const html = dataTransfer?.getData?.('text/html') || '';
  if (html.trim()) {
    const out = htmlToCleanText(html);
    if (out) return out;
  }
  return normalizePastedText(dataTransfer?.getData?.('text/plain') || '');
}
