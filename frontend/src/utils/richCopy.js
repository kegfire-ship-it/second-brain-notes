import { htmlToClipboardText } from './cleanCopy';

// Keep rich copy scoped to actual rich-text surfaces. Native input and textarea
// copying is deliberately left to the browser.
const RICH_COPY_SELECTOR = '[data-rich-copy], .ProseMirror, [contenteditable="true"]';

const elementFor = (node) => {
  if (!node) return null;
  return node.nodeType === 1 ? node : node.parentElement;
};

const richCopyRootFor = (node) => elementFor(node)?.closest(RICH_COPY_SELECTOR) || null;

// Codex's plain-text importer can merge a raw URL at the end of a paragraph
// with the first word of the following paragraph. The HTML payload remains
// literal; only its text fallback spells links as complete Markdown tokens.
// Receivers that use HTML keep the original rich link untouched.
export function htmlToClipboardFallbackText(html) {
  const documentForText = new DOMParser().parseFromString(String(html || ''), 'text/html');

  documentForText.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href') || '';
    if (!/^https?:\/\//iu.test(href)) return;

    const label = link.textContent || href;
    const markdownLabel = label.replace(/([\\\]])/gu, '\\$1');
    const markdownHref = href.replace(/[()]/gu, (character) => (
      character === '(' ? '%28' : '%29'
    ));
    link.replaceWith(documentForText.createTextNode(`[${markdownLabel}](${markdownHref})`));
  });

  return htmlToClipboardText(documentForText.body.innerHTML);
}

/**
 * Put literal selected HTML onto the clipboard for every rich-text surface.
 * This deliberately avoids normalising the fragment: empty paragraphs, inline
 * bold/italic, links and list structure are part of the user's formatting.
 */
export function handleRichCopy(event) {
  const selection = window.getSelection?.();
  const clipboard = event.clipboardData;
  if (!clipboard || !selection || selection.rangeCount === 0 || selection.isCollapsed) return false;

  const range = selection.getRangeAt(0);
  const startRoot = richCopyRootFor(range.startContainer);
  const endRoot = richCopyRootFor(range.endContainer);
  const selectedRoot = startRoot && startRoot === endRoot ? startRoot : null;
  const activeRoot = richCopyRootFor(document.activeElement);

  // A rendered journal entry is intentionally read-only. After the user clicks
  // it and presses Cmd+A, the browser selects the whole page rather than just
  // that entry. Its focused rich-copy root tells us the intended scope.
  const copyRoot = selectedRoot || (
    activeRoot && range.intersectsNode(activeRoot) ? activeRoot : null
  );
  if (!copyRoot) return false;

  const holder = document.createElement('div');
  if (selectedRoot) holder.appendChild(range.cloneContents());
  if (!selectedRoot) holder.innerHTML = copyRoot.innerHTML;
  holder.querySelectorAll('[data-link-display-toggle], [data-link-description-control]').forEach((button) => button.remove());
  const html = holder.innerHTML;
  const text = htmlToClipboardFallbackText(html);
  if (!html || !text) return false;

  clipboard.setData('text/plain', text);
  clipboard.setData('text/html', html);
  event.preventDefault();
  return true;
}
