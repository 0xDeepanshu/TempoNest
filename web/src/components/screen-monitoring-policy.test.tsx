import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenMonitoringPolicyCard } from "@/components/screen-monitoring-policy";
import { apiRequest } from "@/lib/api-client";
import type {
  EmployeeMonitoringPolicy,
  EmployeeMonitoringPolicyResponse,
  MembershipSummary,
  Role,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

function actorFor(role: Role): MembershipSummary {
  return {
    id: "membership-1",
    organizationId: "org-1",
    userId: "actor-1",
    role,
    customRoleId: null,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function policyFor(
  overrides: Partial<EmployeeMonitoringPolicy> = {},
): EmployeeMonitoringPolicyResponse {
  return {
    data: {
      policy: {
        employeeId: "user-2",
        enabled: false,
        organizationEnabled: true,
        effectiveEnabled: false,
        updatedAt: null,
        updatedBy: null,
        ...overrides,
      },
    },
    serverTime: "2026-11-17T12:00:00.000Z",
  };
}

function renderCard({
  actor = actorFor("OWNER"),
  policy = policyFor(),
  saveError,
}: {
  actor?: MembershipSummary;
  policy?: EmployeeMonitoringPolicyResponse;
  saveError?: string;
} = {}) {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (options?.method === "PATCH") {
      if (saveError) throw new Error(saveError);
      const body = options.body as { enabled: boolean };
      return policyFor({
        enabled: body.enabled,
        effectiveEnabled: body.enabled,
        updatedAt: "2026-11-17T12:00:00.000Z",
        updatedBy: { id: "actor-1", name: "Ada Owner", email: "owner@example.com" },
      });
    }
    return policy;
  });

  render(
    <ScreenMonitoringPolicyCard
      organizationId="org-1"
      employeeId="user-2"
      actor={actor}
      employeeName="Sam Lee · sam@example.com"
      timezone="UTC"
    />,
  );
}

describe("ScreenMonitoringPolicyCard", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("defaults to disabled and enables monitoring after confirmation", async () => {
    const user = userEvent.setup();
    renderCard();

    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enable monitoring" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/authorized administrators will be able/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Enable monitoring" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/employees/user-2/monitoring-policy",
        {
          method: "PATCH",
          headers: { "X-Organization-Id": "org-1" },
          body: { enabled: true },
        },
      );
    });
    expect(
      await screen.findByText("Screen monitoring enabled for this employee."),
    ).toBeInTheDocument();
  });

  it("disables monitoring after confirmation and explains cancellation", async () => {
    const user = userEvent.setup();
    renderCard({
      policy: policyFor({
        enabled: true,
        effectiveEnabled: true,
        updatedAt: "2026-11-16T10:00:00.000Z",
        updatedBy: { id: "actor-1", name: "Ada Owner", email: "owner@example.com" },
      }),
    });

    expect(await screen.findByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("Ada Owner")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Disable monitoring" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/terminated/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/pending screenshot requests cancelled/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Disable monitoring" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/employees/user-2/monitoring-policy",
        {
          method: "PATCH",
          headers: { "X-Organization-Id": "org-1" },
          body: { enabled: false },
        },
      );
    });
    expect(
      await screen.findByText("Screen monitoring disabled for this employee."),
    ).toBeInTheDocument();
  });

  it("keeps the control read-only for administrators", async () => {
    renderCard({ actor: actorFor("ADMIN") });

    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(
      screen.getByText("Only an organization owner can change this policy."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable monitoring" })).not.toBeInTheDocument();
  });

  it("explains when the organization policy makes employee monitoring ineffective", async () => {
    renderCard({
      policy: policyFor({
        enabled: true,
        organizationEnabled: false,
        effectiveEnabled: false,
      }),
    });

    expect(
      await screen.findByText(/organization-wide screenshot monitoring is off/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("shows an error and leaves the status unchanged when saving fails", async () => {
    const user = userEvent.setup();
    renderCard({
      policy: policyFor(),
      saveError: "Only an organization owner can change an employee monitoring policy",
    });

    await user.click(await screen.findByRole("button", { name: "Enable monitoring" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Enable monitoring" }));

    expect(
      await screen.findByText(
        "Only an organization owner can change an employee monitoring policy",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
  });
});
