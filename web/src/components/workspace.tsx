"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useContext,
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

export function WorkspaceProvider({
  session,
  children,
}: {
  session: SessionData;
  children: ReactNode;
}) {
  const activeMemberships = useMemo(
    () =>
      session.memberships.filter(
        (membership) => membership.status === "ACTIVE" && membership.organization,
      ),
    [session.memberships],
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
      session,
      user: session.user,
      memberships: session.memberships,
      activeMemberships,
      membership,
      organization: membership?.organization,
      setOrganizationId: (organizationId: string) => {
        window.localStorage.setItem(STORAGE_KEY, organizationId);
        window.dispatchEvent(new Event(STORAGE_EVENT));
      },
    }),
    [session, activeMemberships, membership],
  );

  return <WorkspaceContext value={value}>{children}</WorkspaceContext>;
}

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

export function NoOrganization() {
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
        <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
          <h1 className="text-lg font-bold text-slate-900">Create your organization</h1>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            Your account is not an active member of an organization yet. Create one to start
            managing attendance and time tracking.
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-6">
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
          <p className="text-xs leading-5 text-slate-500">
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
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6">
            <path d="M12 9v4M12 17h.01" strokeLinecap="round" />
            <path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-bold text-slate-900">You do not have access</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          {organization ? (
            <>
              Your <strong>{membership?.role.toLowerCase()}</strong> role in{" "}
              <strong>{organization.name}</strong> does not include <code>{label}</code>. Switch
              organizations or ask an administrator if you need access.
            </>
          ) : (
            "Select or create an organization first."
          )}
        </p>
        <div className="mt-5">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700"
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
    ? hasPermission(membership.role, permission)
    : hasAnyPermission(membership.role, anyOf ?? []);
  if (!allowed) return <AccessDenied permission={permission} anyOf={anyOf} />;
  return <>{children}</>;
}
