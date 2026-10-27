import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuperadminOrganizationDetailView } from "@/components/superadmin-organization-detail-view";
import { apiRequest } from "@/lib/api-client";
import type {
  Paginated,
  PlatformAuditEvent,
  PlatformOrganization,
} from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const organizationId = "11111111-1111-4111-8111-111111111111";

function organization(overrides: Partial<PlatformOrganization> = {}): PlatformOrganization {
  return {
    id: organizationId,
    name: "Acme",
    slug: "acme",
    status: "ACTIVE",
    timezone: "Europe/Berlin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    memberCount: 5,
    activeMemberCount: 4,
    ...overrides,
  };
}

function auditEvents(): PlatformAuditEvent[] {
  return [
    {
      id: "audit-2",
      action: "ORGANIZATION_SUSPENDED",
      actor: {
        id: "platform-1",
        name: "Platform Owner",
        email: "owner@example.com",
      },
      organization: { id: organizationId, name: "Acme" },
      metadata: {
        before: { status: "ACTIVE" },
        after: { status: "SUSPENDED" },
      },
      ipAddress: "203.0.113.10",
      userAgent: "Vitest",
      createdAt: "2026-10-24T12:00:00.000Z",
    },
    {
      id: "audit-1",
      action: "ORGANIZATION_RENAMED",
      actor: {
        id: "platform-1",
        name: "Platform Owner",
        email: "owner@example.com",
      },
      organization: { id: organizationId, name: "Acme" },
      metadata: {
        before: { name: "Acme Old" },
        after: { name: "Acme" },
      },
      ipAddress: null,
      userAgent: null,
      createdAt: "2026-10-23T12:00:00.000Z",
    },
  ];
}

function auditPage(events: PlatformAuditEvent[]): Paginated<PlatformAuditEvent> {
  return {
    data: events,
    meta: { page: 1, limit: 8, total: events.length, totalPages: 1 },
  };
}

describe("SuperadminOrganizationDetailView", () => {
  let current: PlatformOrganization;

  beforeEach(() => {
    mockedApiRequest.mockReset();
    current = organization();

    mockedApiRequest.mockImplementation(async (path, options) => {
      const method = options?.method ?? "GET";

      if (path === "/platform/audit-events" && method === "GET") {
        return auditPage(auditEvents());
      }

      if (path === `/platform/organizations/${organizationId}` && method === "GET") {
        return { data: current };
      }

      if (path === `/platform/organizations/${organizationId}` && method === "PATCH") {
        const body = options?.body as { name: string };
        current = organization({ ...current, name: body.name });
        return { data: current };
      }

      if (
        path === `/platform/organizations/${organizationId}/suspend` &&
        method === "POST"
      ) {
        current = organization({ ...current, status: "SUSPENDED" });
        return { data: current };
      }

      if (
        path === `/platform/organizations/${organizationId}/reactivate` &&
        method === "POST"
      ) {
        current = organization({ ...current, status: "ACTIVE" });
        return { data: current };
      }

      if (path === `/platform/organizations/${organizationId}` && method === "DELETE") {
        current = organization({
          ...current,
          status: "DELETED",
          deletedAt: "2026-10-25T09:00:00.000Z",
        });
        return { data: current };
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    });
  });

  it("shows the stable record and audit changes, and renames without changing the ID", async () => {
    const user = userEvent.setup();
    render(<SuperadminOrganizationDetailView organizationId={organizationId} />);

    expect(await screen.findByRole("heading", { name: "Acme" })).toBeInTheDocument();
    expect(screen.getAllByText(organizationId).length).toBeGreaterThan(0);
    expect(screen.getByText("5 total · 4 active")).toBeInTheDocument();

    expect(screen.getByText("Suspended organization")).toBeInTheDocument();
    expect(screen.getByText("Status: ACTIVE → SUSPENDED")).toBeInTheDocument();
    expect(screen.getByText("Name: Acme Old → Acme")).toBeInTheDocument();
    expect(screen.getAllByText("Platform Owner").length).toBe(2);

    const nameInput = screen.getByLabelText(/Display name/);
    await user.clear(nameInput);
    await user.type(nameInput, "Acme Labs");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/platform/organizations/${organizationId}`,
        { method: "PATCH", body: { name: "Acme Labs" } },
      );
    });

    expect(
      await screen.findByText(
        "Acme Labs renamed. The stable ID, slug, and all relationships are unchanged.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText(organizationId).length).toBeGreaterThan(0);
    expect(screen.getAllByText("acme").length).toBeGreaterThan(0);
  });

  it("suspends and reactivates through accessible confirmation dialogs", async () => {
    const user = userEvent.setup();
    render(<SuperadminOrganizationDetailView organizationId={organizationId} />);

    await screen.findByRole("heading", { name: "Acme" });
    await user.click(screen.getByRole("button", { name: "Suspend organization" }));

    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Suspend Acme?")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Suspend organization" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/platform/organizations/${organizationId}/suspend`,
        { method: "POST" },
      );
    });
    expect(
      await screen.findByText(
        "Acme suspended. Members and agents lose access immediately; data is retained.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reactivate organization" }));
    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reactivate Acme?")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Reactivate organization" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/platform/organizations/${organizationId}/reactivate`,
        { method: "POST" },
      );
    });
    expect(
      await screen.findByText(
        "Acme reactivated. Members and agents can resume access.",
      ),
    ).toBeInTheDocument();
  });

  it("requires the exact name and password before soft deletion", async () => {
    const user = userEvent.setup();
    render(<SuperadminOrganizationDetailView organizationId={organizationId} />);

    await screen.findByRole("heading", { name: "Acme" });
    await user.click(screen.getByRole("button", { name: "Delete organization" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Tenant data is preserved/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/cannot be reactivated from this panel/),
    ).toBeInTheDocument();

    const submit = within(dialog).getByRole("button", {
      name: "Delete organization",
    });
    expect(submit).toBeDisabled();

    const nameInput = within(dialog).getByLabelText(/Type the organization name/);
    await user.type(nameInput, "Wrong");
    expect(
      within(dialog).getByText("The name does not match exactly."),
    ).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(nameInput);
    await user.type(nameInput, "Acme");
    await user.type(within(dialog).getByLabelText(/Your password/), "correct-horse");

    expect(submit).toBeEnabled();
    await user.click(submit);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/platform/organizations/${organizationId}`,
        {
          method: "DELETE",
          body: { confirmationName: "Acme", password: "correct-horse" },
        },
      );
    });

    expect(
      await screen.findByText(
        "Acme soft-deleted. Access is revoked and all tenant data remains retained.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Already deleted")).toBeInTheDocument();
  });
});
