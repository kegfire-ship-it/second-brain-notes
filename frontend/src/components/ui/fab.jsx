import { cn } from '@/lib/utils'

export function Fab({ className, children, ...props }) {
  return (
    <button
      className={cn(
        'inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground',
        'transition hover:bg-[var(--accent-600)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className,
      )}
      style={{ boxShadow: 'var(--glow-accent)' }}
      {...props}
    >
      {children}
    </button>
  )
}
