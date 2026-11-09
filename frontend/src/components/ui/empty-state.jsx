import { cn } from '@/lib/utils'

export function EmptyState({ icon, title, description, action, className }) {
  return (
    <div className={cn('rounded-lg border border-dashed border-line-3 bg-surface-soft px-6 py-9 text-center', className)}>
      {icon && (
        <div className="mx-auto mb-3.5 flex h-13 w-13 items-center justify-center rounded-2xl bg-accent-50 text-primary">
          {icon}
        </div>
      )}
      {title && <h4 className="mb-1.5 text-[15.5px] font-semibold text-ink">{title}</h4>}
      {description && <p className="mx-auto mb-4 max-w-[280px] text-[13.5px] text-ink-2">{description}</p>}
      {action}
    </div>
  )
}
