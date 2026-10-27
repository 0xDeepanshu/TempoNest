import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { getInitials, initialsColor } from "@/lib/format";
import type { CorrectionStatus, MembershipStatus, Role, TrackingState } from "@/lib/types";
import { RefreshIcon } from "./icons";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    "bg-ink text-on-strong hover:bg-ink-secondary focus-visible:outline-ink disabled:bg-line-strong disabled:text-muted",
  secondary:
    "border border-line-strong bg-surface text-ink hover:bg-surface-muted focus-visible:outline-ink disabled:bg-surface-muted disabled:text-muted",
  ghost:
    "text-ink-secondary hover:bg-surface-hover hover:text-ink focus-visible:outline-ink disabled:text-muted",
  danger:
    "bg-danger text-on-strong hover:bg-danger/90 focus-visible:outline-danger disabled:bg-line-strong disabled:text-muted",
  subtle:
    "bg-surface-hover text-ink hover:bg-line focus-visible:outline-ink disabled:text-muted",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-xs",
  md: "h-9 px-3.5 text-[13px]",
  lg: "h-10 px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed",
        buttonVariants[variant],
        buttonSizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
      {children}
    </button>
  );
}

export function Card({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface", className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold text-ink">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs leading-5 text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-4", className)} {...props}>
      {children}
    </div>
  );
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "indigo" | "outline";

const badgeTones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-ink-secondary ring-line-strong",
  success: "bg-success-surface text-success ring-success-border",
  warning: "bg-warning-surface text-warning ring-warning-border",
  danger: "bg-danger-surface text-danger ring-danger-border",
  info: "bg-surface-hover text-ink-secondary ring-line-strong",
  indigo: "bg-ink text-on-strong ring-ink",
  outline: "bg-surface text-ink-secondary ring-line-strong",
};

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ring-1 ring-inset",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    ACTIVE: { tone: "success", label: "Active" },
    SUSPENDED: { tone: "warning", label: "Suspended" },
    REMOVED: { tone: "neutral", label: "Removed" },
    DELETED: { tone: "danger", label: "Deleted" },
    PENDING: { tone: "warning", label: "Pending" },
    APPROVED: { tone: "success", label: "Approved" },
    REJECTED: { tone: "danger", label: "Rejected" },
    WORKING: { tone: "success", label: "Working" },
    ON_BREAK: { tone: "warning", label: "On break" },
    ONLINE: { tone: "info", label: "Online" },
    OFFLINE: { tone: "neutral", label: "Offline" },
    STOPPED: { tone: "neutral", label: "Stopped" },
    ON_BREAK_SESSION: { tone: "warning", label: "On break" },
    CLAIMED: { tone: "info", label: "Claimed" },
    COMPLETED: { tone: "success", label: "Completed" },
    FAILED: { tone: "danger", label: "Failed" },
    EXPIRED: { tone: "neutral", label: "Expired" },
    CANCELLED: { tone: "neutral", label: "Cancelled" },
  };
  const entry = map[status] ?? { tone: "neutral" as const, label: status };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}

export function RoleBadge({ role }: { role: Role }) {
  const map: Record<Role, BadgeTone> = {
    OWNER: "indigo",
    ADMIN: "neutral",
    MANAGER: "outline",
    EMPLOYEE: "outline",
  };
  return (
    <Badge tone={map[role]}>
      {role.charAt(0) + role.slice(1).toLowerCase()}
    </Badge>
  );
}

export function TrackingBadge({ state }: { state: TrackingState }) {
  return <StatusBadge status={state} />;
}

export function CorrectionStatusBadge({ status }: { status: CorrectionStatus }) {
  return <StatusBadge status={status} />;
}

export function MembershipStatusBadge({ status }: { status: MembershipStatus }) {
  return <StatusBadge status={status} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-secondary">
        {label}
        {required ? <span className="ml-0.5 text-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-xs leading-5 text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const inputClass =
  "block w-full rounded-lg border border-line-strong bg-surface px-2.5 py-2 text-[13px] text-ink outline-none transition placeholder:text-muted focus:border-ink focus:ring-2 focus:ring-ink/10 focus-visible:outline-none disabled:bg-surface-muted disabled:text-muted";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(inputClass, "pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(inputClass, "min-h-24", className)} {...props} />;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
          {title}
        </h1>
        {description ? (
          <p className="mt-1 max-w-3xl text-[13px] leading-5 text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent = "indigo",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  accent?: "indigo" | "emerald" | "amber" | "sky" | "rose" | "slate";
  icon?: ReactNode;
}) {
  const accents: Record<string, string> = {
    indigo: "bg-surface-hover text-ink",
    emerald: "bg-surface-hover text-ink",
    amber: "bg-surface-hover text-ink",
    sky: "bg-surface-hover text-ink",
    rose: "bg-surface-hover text-ink",
    slate: "bg-surface-hover text-ink",
  };
  return (
    <Card className="p-4" data-accent={accent}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">{label}</p>
        {icon ? (
          <span className={cn("rounded-md p-1.5", accents[accent])}>{icon}</span>
        ) : null}
      </div>
      <p className="mt-1.5 text-[22px] font-semibold tnum tracking-tight text-ink">{value}</p>
      {hint ? <p className="mt-1 text-xs leading-5 text-muted">{hint}</p> : null}
    </Card>
  );
}

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-line bg-surface-muted px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cn("border-b border-line px-3 py-2.5 align-middle text-ink-secondary", className)}>
      {children}
    </td>
  );
}

export function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: "h-7 w-7 text-[10px]",
    md: "h-8 w-8 text-[11px]",
    lg: "h-11 w-11 text-sm",
  };
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        sizes[size],
        initialsColor(name),
      )}
      aria-hidden
    >
      {getInitials(name)}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center">
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-surface-muted text-muted">
          {icon}
        </div>
      ) : null}
      <p className="text-[13px] font-semibold text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-5 text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("animate-spin", className ?? "h-5 w-5")}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoadingBlock({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="space-y-3 p-4" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3">
          <div className="h-8 w-8 animate-pulse rounded-full bg-surface-hover" />
          <div className="flex-1 space-y-2">
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-surface-hover" />
            <div className="h-2.5 w-2/3 animate-pulse rounded bg-surface-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-danger-border bg-danger-surface px-3.5 py-2.5 text-[13px] text-danger",
        className,
      )}
      role="alert"
    >
      <p className="min-w-0">{message}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshIcon className="h-3.5 w-3.5" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-line bg-surface-muted text-ink-secondary",
    success: "border-success-border bg-success-surface text-success",
    warning: "border-warning-border bg-warning-surface text-warning",
    danger: "border-danger-border bg-danger-surface text-danger",
  };
  return (
    <div className={cn("rounded-lg border px-3.5 py-2.5 text-[13px]", tones[tone], className)} role="status">
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && "mt-1", "text-xs leading-5")}>{children}</div> : null}
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: Array<{ value: T; label: string; count?: number }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5", className)}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          aria-pressed={value === tab.value}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === tab.value
              ? "bg-ink text-on-strong"
              : "text-muted hover:bg-surface-muted hover:text-ink",
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="ml-1.5 text-[10px] font-normal opacity-70">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-xs text-muted">
      <span className="tnum">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-line py-2 text-[13px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 font-medium text-ink">{value}</dd>
    </div>
  );
}
