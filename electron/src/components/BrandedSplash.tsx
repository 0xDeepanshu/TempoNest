import { Loader2 } from 'lucide-react'
import { Logo } from '@/components/Logo'

export function BrandedSplash() {
  return (
    <div className="flex h-full items-center justify-center bg-canvas px-6">
      <div className="animate-fade flex flex-col items-center gap-6">
        <Logo />
        <span className="flex items-center gap-2 text-xs font-medium text-ink-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Preparing your workspace
        </span>
      </div>
    </div>
  )
}
