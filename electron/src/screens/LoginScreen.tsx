import { useState, type FormEvent } from 'react'
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  LifeBuoy,
  Loader2,
  Lock,
  Mail,
  Timer
} from 'lucide-react'
import { BRANDING } from '@shared/branding'
import { useAuth } from '@/auth/AuthProvider'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/Button'
import { useTimer } from '@/tracking/TimerProvider'
import { formatClock } from '@/lib/time'

const inputClassName =
  'h-11 w-full rounded-xl border border-line bg-white pl-10 pr-3 text-sm text-ink shadow-sm outline-none transition placeholder:text-slate-400 focus:border-brand-400 focus:ring-4 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-500'

export function LoginScreen() {
  const { signIn } = useAuth()
  const { status, workElapsedMs, breakElapsedMs } = useTimer()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sessionActive = status !== 'idle'

  function clearError() {
    if (error) setError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    setError(null)
    setSubmitting(true)

    try {
      await signIn({ email, password })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Sign-in could not be completed. Please try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative h-full overflow-y-auto bg-canvas">
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-40 -top-44 h-[520px] w-[520px] rounded-full bg-brand-100/70 blur-3xl" />
        <div className="absolute -bottom-56 right-[-120px] h-[520px] w-[520px] rounded-full bg-emerald-100/60 blur-3xl" />
        <div className="absolute left-[42%] top-[38%] h-64 w-64 rounded-full bg-white/60 blur-3xl" />
      </div>

      <div className="relative mx-auto grid min-h-full w-full max-w-[1500px] lg:grid-cols-[minmax(0,1.05fr)_minmax(440px,0.95fr)]">
        <aside className="hidden flex-col justify-between px-10 py-10 lg:flex xl:px-16 xl:py-14">
          <Logo />

          <div className="max-w-[520px] animate-rise">
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200/80 bg-white/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-700 shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
              Employee desktop
            </span>

            <h1 className="mt-6 text-balance text-[44px] font-semibold leading-[1.06] tracking-[-0.045em] text-ink xl:text-[50px]">
              A calmer way to track your workday.
            </h1>
            <p className="mt-5 max-w-[430px] text-[15px] leading-7 text-ink-muted">
              Start a focused session, take a break when you need one, and keep work and
              break time clear from start to finish.
            </p>

            <ul className="mt-9 space-y-4">
              <li className="flex items-start gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-brand-600 shadow-sm">
                  <Timer className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">One reliable timer</p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                    Work and break durations are timestamped and tracked separately.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-ink-soft shadow-sm">
                  <Building2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-ink">Connected to your organization</p>
                  <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                    Your organization is assigned by invitation, never chosen on this device.
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </aside>

        <main className="flex min-h-full items-center justify-center border-line/80 px-6 py-10 sm:px-10 lg:border-l lg:bg-white/55 lg:backdrop-blur-sm">
          <div className="w-full max-w-[404px] animate-rise">
            <div className="mb-9 lg:hidden">
              <Logo />
            </div>

            <p className="text-[13px] font-semibold text-brand-700">Employee sign in</p>
            <h2 className="mt-1.5 text-[30px] font-semibold tracking-[-0.035em] text-ink">
              Welcome back
            </h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              Use the work email your organization invited to {BRANDING.name}.
            </p>

            {sessionActive ? (
              <div
                className="mt-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-3"
                role="status"
              >
                <span className="relative mt-1.5 flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <div>
                  <p className="text-xs font-semibold text-emerald-900">
                    {status === 'on_break' ? 'Break in progress' : 'Session in progress'}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-emerald-800/80">
                    {formatClock(workElapsedMs)} logged. Sign in to manage your timer
                    {status === 'on_break' ? ` · break ${formatClock(breakElapsedMs)}` : ''}.
                  </p>
                </div>
              </div>
            ) : null}

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-line bg-white/85 px-3.5 py-3 shadow-sm">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">Organization access</p>
                <p className="mt-0.5 text-xs leading-5 text-ink-muted">
                  Assigned by invitation · Employee access only
                </p>
              </div>
            </div>

            <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
              <div>
                <label htmlFor="login-email" className="mb-1.5 block text-xs font-semibold text-ink-soft">
                  Work email
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    spellCheck={false}
                    autoFocus
                    required
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value)
                      clearError()
                    }}
                    disabled={submitting}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                    placeholder="you@company.com"
                    className={inputClassName}
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="login-password"
                  className="mb-1.5 block text-xs font-semibold text-ink-soft"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="login-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value)
                      clearError()
                    }}
                    disabled={submitting}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'login-error' : undefined}
                    placeholder="Enter your password"
                    className={`${inputClassName} pr-11`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    disabled={submitting}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    aria-pressed={showPassword}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              {error ? (
                <div
                  id="login-error"
                  role="alert"
                  className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs leading-5 text-rose-700"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                aria-busy={submitting}
                className="mt-1 w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </form>

            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-line bg-white/55 px-3.5 py-3">
              <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <p className="text-xs leading-5 text-ink-muted">
                No invitation yet? Ask your organization admin to invite you, or contact{' '}
                <span className="font-medium text-ink-soft">{BRANDING.supportEmail}</span>.
              </p>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
