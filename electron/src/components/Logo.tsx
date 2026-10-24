import { Timer } from 'lucide-react'
import { BRANDING } from '@shared/branding'
import { cn } from '@/lib/cn'

interface LogoProps {
  compact?: boolean
  className?: string
}

export function Logo({ compact = false, className }: LogoProps) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[11px] bg-gradient-to-br from-brand-500 to-brand-800 shadow-sm ring-1 ring-inset ring-white/20">
        <span className="absolute inset-x-0 top-0 h-1/2 bg-white/10" aria-hidden="true" />
        <Timer className="relative h-[19px] w-[19px] text-white" strokeWidth={2.2} />
      </span>
      {compact ? null : (
        <span className="min-w-0">
          <span className="block truncate text-[17px] font-semibold leading-none tracking-[-0.035em] text-ink">
            {BRANDING.name}
          </span>
          <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
            {BRANDING.productLabel}
          </span>
        </span>
      )}
    </div>
  )
}
