import Link from "next/link";
import type { ReactNode } from "react";

export function PublicAuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-ink text-lg font-semibold text-on-strong">
            T
          </span>
          <span>
            <span className="block text-base font-semibold tracking-tight text-ink">TempoNest</span>
            <span className="block text-[9px] font-medium uppercase tracking-[0.18em] text-muted">
              Work portal
            </span>
          </span>
        </Link>

        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{title}</h1>
          {description ? <p className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
        </div>

        {children}

        <p className="text-center text-[11px] leading-5 text-muted">
          {footer ?? "Secure cookie session · CSRF protected"}
        </p>
      </div>
    </div>
  );
}
