import { buttonVariants } from './button';
import { cn } from '@/lib/utils';

// ProseMirror widgets and rendered HTML need a DOM control rather than a
// React child. Reuse the kit's button styles; never serialize it into content.
export function createLinkDisplayButton(collapsed, onToggle) {
  const button = document.createElement('button');
  button.type = 'button';
  button.contentEditable = 'false';
  button.dataset.linkDisplayToggle = '';
  button.className = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
    'mx-0.5 inline-flex size-8 select-none align-middle text-ink-3 hover:text-accent-600');
  const label = collapsed ? 'Expand link' : 'Collapse link';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.title = label;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    viewBox: '0 0 24 24', width: '15', height: '15', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round',
    'stroke-linejoin': 'round', 'aria-hidden': 'true',
  })) svg.setAttribute(key, value);
  // Outline expand / collapse arrows, matching the surrounding icon language.
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', collapsed
    ? 'M15 3h6v6 M21 3l-7 7 M9 21H3v-6 M3 21l7-7'
    : 'M4 4l6 6 M10 4v6H4 M20 20l-6-6 M14 20v-6h6');
  svg.append(path);
  button.append(svg);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  return button;
}
