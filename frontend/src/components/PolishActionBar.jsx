import { Check, X } from 'lucide-react';

/**
 * Confirm bar for the polish-selection feature. After the cleaned text is applied
 * in place, this shows two icon buttons — ✓ keep / ✗ revert — at the same spot as
 * the polish FAB. ✓ is the teal primary action, ✗ a soft secondary.
 */
export default function PolishActionBar({ visible, onApply, onRevert }) {
    if (!visible) return null;

    return (
        <div className="absolute right-4 bottom-[72px] sm:bottom-[80px] z-30 flex items-center gap-2 animate-in fade-in zoom-in-95 duration-150">
            <button
                type="button"
                aria-label="Apply"
                title="Apply"
                onClick={onApply}
                style={{ boxShadow: 'var(--glow-accent)' }}
                className="flex flex-shrink-0 items-center justify-center rounded-full bg-[var(--accent)] p-2.5 text-white transition-all hover:bg-[var(--accent-600)] focus:outline-none"
            >
                <Check size={18} className="text-white" strokeWidth={2.2} />
            </button>
            <button
                type="button"
                aria-label="Undo"
                title="Undo"
                onClick={onRevert}
                style={{ boxShadow: 'var(--shadow-md)' }}
                className="flex flex-shrink-0 items-center justify-center rounded-full border border-line bg-surface p-2.5 text-ink-2 transition-all hover:bg-surface-soft hover:text-ink focus:outline-none"
            >
                <X size={18} strokeWidth={2.2} />
            </button>
        </div>
    );
}
