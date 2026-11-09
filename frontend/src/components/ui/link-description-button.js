import { buttonVariants } from './button';
import { cn } from '@/lib/utils';

// DOM widgets reuse the kit, but are never part of the editor document.
export function createLinkDescriptionButton({ loading, error, onClick }) {
  const wrapper = document.createElement('span');
  wrapper.contentEditable = 'false';
  wrapper.dataset.linkDescriptionControl = '';
  wrapper.className = 'inline-flex items-center align-middle';
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.linkDescription = '';
  button.className = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
    'mx-0.5 inline-flex size-8 select-none align-middle text-ink-3 hover:text-accent-600');
  const label = loading ? 'Reading the site…' : error ? 'Retry link description' : 'Add link description';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-busy', String(!!loading));
  button.disabled = !!loading;
  button.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5"/></svg>';
  // Keep a tap from moving the caret or opening the iOS keyboard.
  button.addEventListener('mousedown', event => event.preventDefault());
  button.addEventListener('click', event => {
    event.preventDefault(); event.stopPropagation(); onClick();
  });
  wrapper.append(button);
  if (loading || error) {
    const status = document.createElement('span');
    status.className = 'mx-1 text-xs font-sans text-ink-3';
    status.setAttribute('role', error ? 'alert' : 'status');
    status.textContent = error || 'Reading the site…';
    wrapper.append(status);
  }
  return wrapper;
}
