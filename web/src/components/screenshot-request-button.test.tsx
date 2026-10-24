import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScreenshotRequestButton } from "@/components/screenshot-request-button";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { Organization, SessionData } from "@/lib/types";

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
      role: "OWNER",
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

function renderButton(props: { disabled?: boolean; disabledReason?: string } = {}) {
  const onRequested = vi.fn();
  render(
    <WorkspaceProvider session={session}>
      <ScreenshotRequestButton
        employeeId="employee-1"
        employeeName="Ada Lovelace"
        onRequested={onRequested}
        {...props}
      />
    </WorkspaceProvider>,
  );
  return { onRequested };
}

describe("ScreenshotRequestButton", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("sends an explicit idempotent request and reports delivery", async () => {
    const user = userEvent.setup();
    const { onRequested } = renderButton();
    mockedApiRequest.mockResolvedValue({
      data: {
        request: { id: "request-1" },
        replayed: false,
        agentOnline: true,
        delivered: true,
      },
      serverTime: "2026-10-24T12:00:00.000Z",
    });

    await user.click(screen.getByRole("button", { name: /Request screenshot/ }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/employees/employee-1/screenshot-requests",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "X-Organization-Id": "org-1",
            "Idempotency-Key": expect.any(String),
          }),
          body: {},
        }),
      );
    });
    expect(
      await screen.findByText(
        "The request was delivered to the employee's desktop agent. Capture starts only after the agent validates it.",
      ),
    ).toBeInTheDocument();
    expect(onRequested).toHaveBeenCalledTimes(1);
  });

  it("surfaces policy-disabled errors without claiming a capture", async () => {
    const user = userEvent.setup();
    renderButton();
    mockedApiRequest.mockRejectedValue(
      new ApiError({
        status: 403,
        code: "SCREENSHOT_POLICY_DISABLED",
        message: "Monitoring is disabled",
      }),
    );

    await user.click(screen.getByRole("button", { name: /Request screenshot/ }));

    expect(
      await screen.findByText(
        "Screen monitoring is disabled for this organization. An owner or administrator must enable it in monitoring settings first.",
      ),
    ).toBeInTheDocument();
  });

  it("does not contact the backend when the request is not eligible", async () => {
    const user = userEvent.setup();
    renderButton({
      disabled: true,
      disabledReason: "The employee's desktop agent is offline.",
    });

    const button = screen.getByRole("button", { name: /Request screenshot/ });
    expect(button).toBeDisabled();
    await user.click(button);

    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(
      screen.getByText("The employee's desktop agent is offline."),
    ).toBeInTheDocument();
  });
});
