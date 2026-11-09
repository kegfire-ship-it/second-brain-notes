import { useId } from 'react';
import { motion as Motion } from 'framer-motion';
import { Sun, Moon, Monitor } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/lib/theme';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/**
 * Three-way theme switch (light / dark / follow the OS) — a segmented pill.
 * The white «thumb» glides to the pressed option while the page softly fades
 * into the new theme (lib/theme.js). The choice is saved per device.
 */
export function ThemeSwitcher({ className }) {
  const { theme, setTheme } = useTheme();
  const thumbId = useId();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface-soft p-1', className)}
    >
      {OPTIONS.map((opt) => {
        const { value, label } = opt;
        const Icon = opt.Icon;
        const on = theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(value)}
            className={cn(
              'relative flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11.5px] font-semibold leading-tight transition-colors focus:outline-none',
              on ? 'text-accent-600' : 'text-ink-3 hover:text-ink-2',
            )}
          >
            {on && (
              <Motion.span
                layoutId={thumbId}
                aria-hidden="true"
                className="absolute inset-0 rounded-lg bg-surface shadow-[var(--shadow-sm)]"
                transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              />
            )}
            <Icon size={17} strokeWidth={1.8} aria-hidden="true" className="relative" />
            <span className="relative text-center">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
