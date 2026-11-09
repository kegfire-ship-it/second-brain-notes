import { cn } from '@/lib/utils'

// Category -> CSS-var trio (defined in index.css). Sentence-case label supplied by caller.
const CATS = {
  ideas:      { bg: 'var(--cat-ideas-bg)',  tx: 'var(--cat-ideas-tx)',  dot: 'var(--cat-ideas-dot)' },
  philosophy: { bg: 'var(--cat-philo-bg)',  tx: 'var(--cat-philo-tx)',  dot: 'var(--cat-philo-dot)' },
  projects:   { bg: 'var(--cat-proj-bg)',   tx: 'var(--cat-proj-tx)',   dot: 'var(--cat-proj-dot)' },
  health:     { bg: 'var(--cat-health-bg)', tx: 'var(--cat-health-tx)', dot: 'var(--cat-health-dot)' },
  misc:       { bg: 'var(--cat-misc-bg)',   tx: 'var(--cat-misc-tx)',   dot: 'var(--cat-misc-dot)' },
}

export function CategoryChip({ category = 'misc', children, className, ...props }) {
  const c = CATS[category] || CATS.misc
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-none',
        className,
      )}
      style={{ background: c.bg, color: c.tx }}
      {...props}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.dot }} />
      {children}
    </span>
  )
}
