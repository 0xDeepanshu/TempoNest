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
        scheduledCaptureEnabled: false,
        scheduledCaptureActive: false,
        captureIntervalMinutes: 30,
        nextCaptureAt: null,
        lastCaptureAt: null,
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
  let current = policy;
  mockedApiRequest.mockImplementation(async (_path, options) => {
    if (options?.method === "PATCH") {
      if (saveError) throw new Error(saveError);
      const body = options.body as {
        enabled?: boolean;
        scheduledCaptureEnabled?: boolean;
        captureIntervalMinutes?: number;
      };
      const enabled = body.enabled ?? current.data.policy.enabled;
      // Mirrors the backend: disabling general monitoring also disables the
      // schedule, so the two switches never diverge.
      const scheduledCaptureEnabled =
        body.scheduledCaptureEnabled ??
        (enabled ? current.data.policy.scheduledCaptureEnabled : false);
      current = policyFor({
        employeeId: current.data.policy.employeeId,
        enabled,
        scheduledCaptureEnabled,
        scheduledCaptureActive:
          scheduledCaptureEnabled && current.data.policy.organizationEnabled,
        captureIntervalMinutes:
          body.captureIntervalMinutes ?? current.data.policy.captureIntervalMinutes,
        nextCaptureAt: scheduledCaptureEnabled
          ? (current.data.policy.nextCaptureAt ?? "2026-11-17T12:30:00.000Z")
          : null,
        lastCaptureAt: current.data.policy.lastCaptureAt,
        organizationEnabled: current.data.policy.organizationEnabled,
        effectiveEnabled: enabled && current.data.policy.organizationEnabled,
        updatedAt: "2026-11-17T12:00:00.000Z",
        updatedBy: { id: "actor-1", name: "Ada Owner", email: "owner@example.com" },
      });
    }
    return current;
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

  it("defaults to disabled with scheduled capture set to Never", async () => {
    renderCard();

    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(screen.getByText("Scheduled screenshots")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Scheduled screenshot capture interval" }),
    ).toHaveValue("never");
    expect(
      screen.getByText(/enable monitoring before scheduling automatic screenshots/i),
    ).toBeInTheDocument();
  });

  it("enables general monitoring after confirmation without touching the schedule", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(await screen.findByRole("button", { name: "Enable monitoring" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/request screenshots and view the live screen/i),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/automatic periodic capture stays off/i),
    ).toBeInTheDocument();
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

  it("disabling general monitoring also turns the schedule off", async () => {
    const user = userEvent.setup();
    renderCard({
      policy: policyFor({
        enabled: true,
        effectiveEnabled: true,
        scheduledCaptureEnabled: true,
        scheduledCaptureActive: true,
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
    expect(
      within(dialog).getByText(/scheduled capture will also be turned off/i),
    ).toBeInTheDocument();
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

  it("enables scheduled capture with an interval and warns about resource use", async () => {
    const user = userEvent.setup();
    renderCard({
      policy: policyFor({ enabled: true, effectiveEnabled: true }),
    });

    expect(await screen.findByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText(/no automatic screenshots are captured/i)).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Scheduled screenshot capture interval" }),
      "15",
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/employees/user-2/monitoring-policy",
        {
          method: "PATCH",
          headers: { "X-Organization-Id": "org-1" },
          body: { scheduledCaptureEnabled: true, captureIntervalMinutes: 15 },
        },
      );
    });
    expect(await screen.findByText("Every 15 min")).toBeInTheDocument();
    expect(screen.getByText(/use extra resources/i)).toBeInTheDocument();
    expect(
      await screen.findByText("Scheduled screenshots enabled every 15 minutes."),
    ).toBeInTheDocument();
  });

  it("turns scheduled capture off again by selecting Never", async () => {
    const user = userEvent.setup();
    renderCard({
      policy: policyFor({
        enabled: true,
        effectiveEnabled: true,
        scheduledCaptureEnabled: true,
        scheduledCaptureActive: true,
        captureIntervalMinutes: 10,
        nextCaptureAt: "2026-11-17T12:10:00.000Z",
        lastCaptureAt: "2026-11-17T12:00:00.000Z",
      }),
    });

    expect(await screen.findByText("Every 10 min")).toBeInTheDocument();
    expect(screen.getByText(/last capture:/i)).toBeInTheDocument();
    expect(screen.getByText(/next scheduled capture:/i)).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Scheduled screenshot capture interval" }),
      "never",
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/employees/user-2/monitoring-policy",
        {
          method: "PATCH",
          headers: { "X-Organization-Id": "org-1" },
          body: { scheduledCaptureEnabled: false },
        },
      );
    });
    expect(
      await screen.findByText("Scheduled screenshots turned off for this employee."),
    ).toBeInTheDocument();
  });

  it("disables the schedule control while general monitoring is off", async () => {
    renderCard();

    expect(
      await screen.findByRole("combobox", { name: "Scheduled screenshot capture interval" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/enable monitoring before scheduling automatic screenshots/i),
    ).toBeInTheDocument();
  });

  it("keeps the control read-only for managers without the monitoring permission", async () => {
    renderCard({ actor: actorFor("MANAGER") });

    expect(await screen.findByText("Disabled")).toBeInTheDocument();
    expect(
      screen.getByText("Your role cannot change this policy."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable monitoring" })).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Scheduled screenshot capture interval" }),
    ).toBeDisabled();
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
