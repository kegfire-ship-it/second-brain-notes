import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeSwitcher } from '@/components/ui/theme-switcher';
import { cn } from '@/lib/utils';

export const MENU_LABEL = 'text-[11px] font-bold uppercase tracking-[0.14em] text-accent-600';

/** One labelled block at the top of the menu (e.g. Sort on notes). */
export function MenuSection({ label, children }) {
  return (
    <div className="p-4 border-b border-line">
      <h3 className={cn(MENU_LABEL, 'mb-3 ml-1')}>{label}</h3>
      {children}
    </div>
  );
}

function MenuItem({ icon, label, onClick }) {
  const Icon = icon;
  return (
    <Button variant="ghost" onClick={onClick} className="w-full justify-start gap-3">
      <Icon size={18} strokeWidth={1.8} /> {label}
    </Button>
  );
}

/**
 * The burger menu: a drawer from the right.
 *   top   — blocks above Theme (wrap each in <MenuSection>)
 *   items — [{ label, Icon, onClick }] buttons below it
 */
export default function AppMenu({ open, onClose, top, items = [] }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const pick = (fn) => () => { onClose(); fn(); };

  return (
    <>
      {open && createPortal(
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40 animate-in fade-in duration-200"
            onClick={onClose}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            className="relative w-72 max-w-[85vw] h-full bg-surface border-l border-line flex flex-col overflow-y-auto shadow-[var(--shadow-modal)] animate-in slide-in-from-right duration-200"
          >
            <div className="p-6 border-b border-line flex justify-between items-center bg-surface-soft">
              <h2 className="text-[17px] font-semibold text-ink">Menu</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex items-center justify-center rounded-[11px] border border-line p-2 text-ink-2 transition-colors hover:bg-surface-soft hover:text-ink focus:outline-none"
              >
                <ArrowLeft size={18} strokeWidth={1.8} className="rotate-180" />
              </button>
            </div>

            {top}

            <MenuSection label="Theme">
              <ThemeSwitcher />
            </MenuSection>

            <div className="p-4 flex-1 flex flex-col gap-1.5">
              {items.map((it) => (
                <MenuItem key={it.label} icon={it.Icon} label={it.label} onClick={pick(it.onClick)} />
              ))}
            </div>

          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
