"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { apiRequest } from "@/lib/api-client";
import { errorMessage } from "@/lib/api-error";
import {
  hasAnyPermission,
  hasPermission,
  type Permission,
} from "@/lib/permissions";
import type { MembershipSummary, Organization, SessionData } from "@/lib/types";
import { Alert, Button, Card, Field, Input } from "./ui";

interface WorkspaceValue {
  session: SessionData;
  user: SessionData["user"];
  memberships: MembershipSummary[];
  activeMemberships: MembershipSummary[];
  membership: MembershipSummary | undefined;
  organization: Organization | undefined;
  setOrganizationId: (organizationId: string) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

const STORAGE_KEY = "temponest.organization";
const STORAGE_EVENT = "temponest:organization";

function subscribeToOrganization(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(STORAGE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(STORAGE_EVENT, callback);
  };
}

function storedOrganizationId(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

function serverOrganizationId(): string | null {
  return null;
}

const PERMISSION_REFRESH_THROTTLE_MS = 5_000;

export function WorkspaceProvider({
  session,
  children,
}: {
  session: SessionData;
  children: ReactNode;
}) {
  // The server session is the source of truth after a navigation or refresh.
  // A client-side refresh can update it in place when a role changes, but a new
  // server prop always wins.
  const [sessionState, setSessionState] = useState(() => ({
    source: session,
    value: session,
  }));
  if (sessionState.source !== session) {
    setSessionState({ source: session, value: session });
  }
  const currentSession = sessionState.value;

  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let lastFetchAt = 0;

    async function refresh(force: boolean) {
      if (disposed || inFlight) return;
      const now = Date.now();
      if (!force && now - lastFetchAt < PERMISSION_REFRESH_THROTTLE_MS) return;
      inFlight = true;
      lastFetchAt = now;
      try {
        const response = await apiRequest<{ data?: SessionData }>("/auth/me");
        const next = response.data;
        if (disposed || !next) return;
        setSessionState((previous) => {
          if (previous.source !== session) return previous;
          if (JSON.stringify(previous.value) === JSON.stringify(next)) return previous;
          return { source: session, value: next };
        });
      } catch {
        // Keep the last known permissions. Authentication expiry is handled by
        // the API client's global 401 event.
      } finally {
        inFlight = false;
      }
    }

    function refreshOnFocus() {
      void refresh(false);
    }
    function refreshOnVisible() {
      if (document.visibilityState === "visible") void refresh(false);
    }
    function refreshNow() {
      void refresh(true);
    }

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisible);
    window.addEventListener("tn:permissions-changed", refreshNow);
    window.addEventListener("tn:permission-denied", refreshNow);
    return () => {
      disposed = true;
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisible);
      window.removeEventListener("tn:permissions-changed", refreshNow);
      window.removeEventListener("tn:permission-denied", refreshNow);
    };
  }, [session]);

  const activeMemberships = useMemo(
    () =>
      currentSession.memberships.filter(
        (membership) =>
          membership.status === "ACTIVE" &&
          membership.organization?.status === "ACTIVE",
      ),
    [currentSession.memberships],
  );

  // Reading the persisted selection through useSyncExternalStore keeps the
  // server render and hydration deterministic while still restoring the last
  // organization chosen in this browser.
  const selectedId = useSyncExternalStore(
    subscribeToOrganization,
    storedOrganizationId,
    serverOrganizationId,
  );

  const membership =
    (selectedId
      ? activeMemberships.find((item) => item.organizationId === selectedId)
      : undefined) ?? activeMemberships[0];

  const value = useMemo<WorkspaceValue>(
    () => ({
      session: currentSession,
      user: currentSession.user,
      memberships: currentSession.memberships,
      activeMemberships,
      membership,
      organization: membership?.organization,
      setOrganizationId: (organizationId: string) => {
        window.localStorage.setItem(STORAGE_KEY, organizationId);
        window.dispatchEvent(new Event(STORAGE_EVENT));
      },
    }),
    [currentSession, activeMemberships, membership],
  );

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

function SuspendedOrganization({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-xl py-8">
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-surface-muted px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Organization suspended
          </h1>
          <p className="mt-1 text-sm leading-6 text-muted">
            Your membership in <strong>{name}</strong> is active, but the organization has
            been suspended by the platform administrator.
          </p>
        </div>
        <div className="space-y-3 p-5 text-sm leading-6 text-ink-secondary">
          <p>
            Access to attendance, reports, corrections, screenshots, and desktop agents is
            blocked until the organization is reactivated.
          </p>
          <p className="text-xs text-muted">
            No organization data has been deleted. Contact your TempoNest platform
            administrator to reactivate the organization.
          </p>
        </div>
      </Card>
    </div>
  );
}

export function NoOrganization() {
  const { session } = useWorkspace();
  const suspendedOrganization = session.memberships.find(
    (membership) =>
      membership.status === "ACTIVE" &&
      membership.organization?.status === "SUSPENDED",
  )?.organization;

  if (suspendedOrganization) {
    return <SuspendedOrganization name={suspendedOrganization.name} />;
  }
  return <CreateOrganization />;
}

function CreateOrganization() {
  const router = useRouter();
  const browserTimezone =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(browserTimezone || "UTC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (name.trim().length < 2) {
      setError("Enter an organization name with at least 2 characters.");
      return;
    }
    setLoading(true);
    try {
      await apiRequest("/organizations", {
        method: "POST",
        body: { name: name.trim(), timezone },
      });
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl py-8">
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-surface-muted px-5 py-4">
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            Create your organization
          </h1>
          <p className="mt-1 text-sm leading-6 text-muted">
            Your account is not an active member of an organization yet. Create one to start
            managing attendance and time tracking.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-5">
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Field label="Organization name" htmlFor="organization-name" required>
            <Input
              id="organization-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Acme Corp"
              autoComplete="organization"
              required
            />
          </Field>
          <Field
            label="Timezone"
            htmlFor="organization-timezone"
            hint="Attendance summaries and report dates use this IANA timezone."
            required
          >
            <Input
              id="organization-timezone"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Berlin"
              required
            />
          </Field>
          <Button type="submit" loading={loading}>
            Create organization
          </Button>
          <p className="text-xs leading-5 text-muted">
            If someone already invited you, ask them for the invitation link. Invited accounts
            join with the role chosen by the organization administrator.
          </p>
        </form>
      </Card>
    </div>
  );
}

export function AccessDenied({
  permission,
  anyOf,
}: {
  permission?: Permission;
  anyOf?: Permission[];
}) {
  const { membership, organization } = useWorkspace();
  const label = permission ?? anyOf?.join(" or ") ?? "this area";
  return (
    <div className="mx-auto max-w-2xl py-10">
      <Card className="p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-muted text-muted">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">
          You do not have access
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
          {organization ? (
            <>
              Your{" "}
              <strong>
                {membership?.customRole?.name ?? membership?.role.toLowerCase()}
              </strong>{" "}
              role in <strong>{organization.name}</strong> does not include{" "}
              <code>{label}</code>. Switch organizations or ask an administrator if you need
              access.
            </>
          ) : (
            "Select or create an organization first."
          )}
        </p>
        <div className="mt-5">
          <Link
            href="/dashboard"
            className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-[13px] font-medium text-on-strong transition hover:bg-ink-secondary"
          >
            Back to dashboard
          </Link>
        </div>
      </Card>
    </div>
  );
}

export function PermissionGate({
  permission,
  anyOf,
  children,
}: {
  permission?: Permission;
  anyOf?: Permission[];
  children: ReactNode;
}) {
  const { membership } = useWorkspace();
  if (!membership) return <NoOrganization />;
  const allowed = permission
    ? hasPermission(membership, permission)
    : hasAnyPermission(membership, anyOf ?? []);
  if (!allowed) return <AccessDenied permission={permission} anyOf={anyOf} />;
  return <>{children}</>;
}
