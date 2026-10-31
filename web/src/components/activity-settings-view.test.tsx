import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySettingsView } from "@/components/activity-settings-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type { Organization, Role, SessionData, TrackingSettings } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const organization: Organization = {
  id: "org-1",
  name: "TempoNest",
  slug: "temponest",
  status: "ACTIVE",
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function sessionFor(role: Role): SessionData {
  return {
    platformRole: null,
    user: {
      id: "admin-1",
      name: "Admin",
      email: "admin@example.com",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership-1",
        organizationId: "org-1",
        userId: "admin-1",
        role,
        status: "ACTIVE",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        organization,
      },
    ],
    session: {
      id: "session-1",
      transport: "cookie",
      accessExpiresAt: "2026-10-24T12:00:00.000Z",
      refreshExpiresAt: "2026-11-24T12:00:00.000Z",
    },
  };
}

function settings(overrides: Partial<TrackingSettings> = {}): TrackingSettings {
  return {
    organizationId: "org-1",
    appTrackingEnabled: true,
    idleDetectionEnabled: true,
    idleThresholdMinutes: 5,
    productivityClassificationEnabled: true,
    activityRetentionDays: 90,
    policyVersion: 1,
    policyUpdatedAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderSettings(role: Role = "OWNER") {
  return render(
    <WorkspaceProvider session={sessionFor(role)}>
      <ActivitySettingsView />
    </WorkspaceProvider>,
  );
}

describe("ActivitySettingsView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("loads and saves collection controls with validated numbers", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path === "/organizations/org-1/activity/settings" && (options?.method ?? "GET") === "GET") {
        return { data: { settings: settings() }, serverTime: "2026-10-30T12:00:00.000Z" };
      }
      if (path === "/organizations/org-1/activity/settings" && options?.method === "PATCH") {
        return {
          data: {
            settings: settings({
              appTrackingEnabled: false,
              idleThresholdMinutes: 10,
              activityRetentionDays: 120,
              policyVersion: 2,
              policyUpdatedAt: "2026-10-30T12:00:00.000Z",
            }),
          },
          serverTime: "2026-10-30T12:00:00.000Z",
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderSettings();

    expect(await screen.findByText(/Policy v1/)).toBeInTheDocument();
    expect(screen.getByText(/Policy last updated/)).toBeInTheDocument();

    await user.click(
      screen.getByRole("checkbox", { name: /Allow application tracking/ }),
    );
    const threshold = screen.getByLabelText(/Idle threshold/);
    await user.clear(threshold);
    await user.type(threshold, "10");
    const retention = screen.getByLabelText(/Raw activity retention/);
    await user.clear(retention);
    await user.type(retention, "120");

    await user.click(screen.getByRole("button", { name: "Save tracking settings" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/activity/settings",
        expect.objectContaining({
          method: "PATCH",
          body: {
            appTrackingEnabled: false,
            idleDetectionEnabled: true,
            idleThresholdMinutes: 10,
            productivityClassificationEnabled: true,
            activityRetentionDays: 120,
          },
        }),
      );
    });
    expect(await screen.findByText("Tracking settings saved")).toBeInTheDocument();
    expect((await screen.findAllByText(/Policy v2/)).length).toBeGreaterThan(0);
  });

  it("blocks saving when the idle threshold is outside 1–120 minutes", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValue({
      data: { settings: settings() },
      serverTime: "2026-10-30T12:00:00.000Z",
    });

    renderSettings();

    const threshold = await screen.findByLabelText(/Idle threshold/);
    await user.clear(threshold);
    await user.type(threshold, "0");
    await user.click(screen.getByRole("button", { name: "Save tracking settings" }));

    expect(
      await screen.findByText(
        "Idle threshold must be a whole number between 1 and 120 minutes.",
      ),
    ).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(([, options]) => options?.method === "PATCH"),
    ).toBe(false);
  });

  it("blocks saving when retention is outside 7–3650 days", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValue({
      data: { settings: settings() },
      serverTime: "2026-10-30T12:00:00.000Z",
    });

    renderSettings();

    const retention = await screen.findByLabelText(/Raw activity retention/);
    await user.clear(retention);
    await user.type(retention, "3");
    await user.click(screen.getByRole("button", { name: "Save tracking settings" }));

    expect(
      await screen.findByText(
        "Activity retention must be a whole number between 7 and 3650 days.",
      ),
    ).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(([, options]) => options?.method === "PATCH"),
    ).toBe(false);
  });

  it("shows a read-only policy to managers", async () => {
    mockedApiRequest.mockResolvedValue({
      data: { settings: settings() },
      serverTime: "2026-10-30T12:00:00.000Z",
    });

    renderSettings("MANAGER");

    expect(await screen.findByText("Read-only view")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: /Allow application tracking/ }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save tracking settings" })).toBeDisabled();
  });
});
