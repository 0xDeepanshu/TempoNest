import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'border border-transparent bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300 disabled:shadow-none',
  secondary:
    'border border-line bg-white text-ink-soft shadow-sm hover:border-line-strong hover:bg-slate-50 hover:text-ink active:bg-slate-100 disabled:bg-slate-50 disabled:text-slate-400',
  ghost:
    'border border-transparent bg-transparent text-ink-soft hover:bg-slate-100 hover:text-ink active:bg-slate-200/70 disabled:text-slate-400',
  danger:
    'border border-rose-200 bg-white text-rose-600 shadow-sm hover:border-rose-300 hover:bg-rose-50 active:bg-rose-100 disabled:border-rose-100 disabled:text-rose-300'
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 rounded-lg px-3 text-[13px]',
  md: 'h-10 gap-2 rounded-[10px] px-4 text-sm',
  lg: 'h-12 gap-2.5 rounded-xl px-5 text-[15px]'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        'active:translate-y-px disabled:pointer-events-none',
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
