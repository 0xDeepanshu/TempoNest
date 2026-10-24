import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MonitoringDisclosure } from "@/components/monitoring-disclosure";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  Organization,
  ScreenshotPolicyDisclosure,
  SessionData,
} from "@/lib/types";

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

const session: SessionData = {
  user: {
    id: "employee-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  memberships: [
    {
      id: "membership-1",
      organizationId: "org-1",
      userId: "employee-1",
      role: "EMPLOYEE",
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

function disclosure(overrides: Partial<ScreenshotPolicyDisclosure> = {}): ScreenshotPolicyDisclosure {
  return {
    enabled: true,
    retentionDays: 30,
    disclosure: {
      version: "2026-10-01",
      text: "A permitted administrator may request one visible screenshot while you are working.",
      acknowledgementRequired: true,
      acknowledged: false,
      acknowledgedAt: null,
    },
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderDisclosure() {
  return render(
    <WorkspaceProvider session={session}>
      <MonitoringDisclosure />
    </WorkspaceProvider>,
  );
}

describe("MonitoringDisclosure", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("requires an explicit acknowledgement before recording it", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (path === "/screenshot-policy" && (options?.method ?? "GET") === "GET") {
        return { data: { policy: disclosure() }, serverTime: "2026-10-24T12:00:00.000Z" };
      }
      if (path === "/screenshot-policy/acknowledge" && options?.method === "POST") {
        return {
          data: {
            policy: disclosure({
              disclosure: {
                ...disclosure().disclosure,
                acknowledged: true,
                acknowledgedAt: "2026-10-24T12:00:00.000Z",
              },
            }),
          },
          serverTime: "2026-10-24T12:00:00.000Z",
        };
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    renderDisclosure();

    expect(await screen.findByText("Action required")).toBeInTheDocument();
    const acknowledgeButton = screen.getByRole("button", { name: "Acknowledge disclosure" });
    expect(acknowledgeButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    await user.click(acknowledgeButton);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/screenshot-policy/acknowledge",
        expect.objectContaining({ method: "POST", body: {} }),
      );
    });
    expect(await screen.findByText("Acknowledged")).toBeInTheDocument();
  });

  it("states clearly when monitoring is disabled", async () => {
    mockedApiRequest.mockResolvedValue({
      data: {
        policy: disclosure({
          enabled: false,
          disclosure: {
            ...disclosure().disclosure,
            acknowledgementRequired: false,
          },
        }),
      },
      serverTime: "2026-10-24T12:00:00.000Z",
    });

    renderDisclosure();

    expect(
      await screen.findByText("Screen monitoring is disabled"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
