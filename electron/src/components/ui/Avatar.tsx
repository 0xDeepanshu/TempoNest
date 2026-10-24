import { cn } from '@/lib/cn'

interface AvatarProps {
  initials: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeStyles = {
  sm: 'h-8 w-8 text-[11px]',
  md: 'h-9 w-9 text-xs',
  lg: 'h-16 w-16 text-xl'
}

export function Avatar({ initials, size = 'md', className }: AvatarProps) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-800 font-semibold tracking-wide text-white shadow-sm ring-2 ring-white',
        sizeStyles[size],
        className
      )}
      aria-hidden="true"
    >
      {initials}
    </span>
  )
}
