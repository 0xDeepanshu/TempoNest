import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuperadminAuditView } from "@/components/superadmin-audit-view";
import { apiRequest } from "@/lib/api-client";
import type { Paginated, PlatformAuditEvent } from "@/lib/types";

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

const events: PlatformAuditEvent[] = [
  {
    id: "audit-2",
    action: "ORGANIZATION_SOFT_DELETED",
    actor: { id: "platform-1", name: "Platform Owner", email: "owner@example.com" },
    organization: { id: organizationId, name: "Acme" },
    metadata: {
      before: { name: "Acme", status: "ACTIVE", deletedAt: null },
      after: {
        name: "Acme",
        status: "ACTIVE",
        deletedAt: "2026-10-25T09:00:00.000Z",
      },
      retention: "tenant_data_preserved",
    },
    ipAddress: "203.0.113.10",
    userAgent: "Vitest",
    createdAt: "2026-10-25T09:00:00.000Z",
  },
  {
    id: "audit-1",
    action: "ORGANIZATION_RENAMED",
    actor: { id: "platform-1", name: "Platform Owner", email: "owner@example.com" },
    organization: { id: organizationId, name: "Acme" },
    metadata: {
      before: { name: "Acme Old" },
      after: { name: "Acme" },
    },
    ipAddress: null,
    userAgent: null,
    createdAt: "2026-10-24T09:00:00.000Z",
  },
];

function auditPage(rows: PlatformAuditEvent[], page = 1): Paginated<PlatformAuditEvent> {
  return {
    data: rows,
    meta: { page, limit: 20, total: 42, totalPages: 3 },
  };
}

describe("SuperadminAuditView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path === "/platform/audit-events") {
        return auditPage(events, Number(options?.query?.page ?? 1));
      }
      throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${path}`);
    });
  });

  it("filters by organization and action and renders before/after details", async () => {
    const user = userEvent.setup();
    render(<SuperadminAuditView initialOrganizationId={organizationId} />);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/platform/audit-events",
        expect.objectContaining({
          query: expect.objectContaining({ organizationId, page: 1, limit: 20 }),
        }),
      );
    });

    const info = screen.getByRole("status");
    expect(info).toHaveTextContent(/Showing events for/);
    expect(screen.getAllByText("Acme").length).toBeGreaterThan(0);

    const table = screen.getByRole("table");
    expect(within(table).getByText("Soft-deleted organization")).toBeInTheDocument();
    expect(
      within(table).getByText("Access revoked; tenant data preserved"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Name: Acme Old → Acme")).toBeInTheDocument();
    expect(within(table).getAllByText("Platform Owner").length).toBe(2);

    await user.selectOptions(
      screen.getByLabelText("Filter by action"),
      "ORGANIZATION_RENAMED",
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/platform/audit-events",
        expect.objectContaining({
          query: expect.objectContaining({
            organizationId,
            action: "ORGANIZATION_RENAMED",
            page: 1,
          }),
        }),
      );
    });
  });

  it("paginates audit events", async () => {
    const user = userEvent.setup();
    render(<SuperadminAuditView />);

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/platform/audit-events",
        expect.objectContaining({
          query: expect.objectContaining({ page: 2 }),
        }),
      );
    });
  });

  it("renders an empty state when no events match", async () => {
    mockedApiRequest.mockImplementation(async (path) => {
      if (path === "/platform/audit-events") {
        return { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    render(<SuperadminAuditView />);

    expect(await screen.findByText("No audit events")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows the active action filter in the table", async () => {
    render(<SuperadminAuditView initialOrganizationId={organizationId} />);

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Soft-deleted organization").closest("tr");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByText("Soft-deleted organization"),
    ).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText("Acme")).toBeInTheDocument();
  });
});
