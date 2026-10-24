import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CorrectionReviewView } from "@/components/correction-review-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import type {
  AttendanceCorrection,
  MemberListItem,
  Organization,
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
    id: "reviewer-1",
    name: "Reviewer",
    email: "reviewer@example.com",
    status: "ACTIVE",
    lastLoginAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  memberships: [
    {
      id: "membership-1",
      organizationId: "org-1",
      userId: "reviewer-1",
      role: "MANAGER",
      status: "ACTIVE",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      organization,
    },
  ],
  session: {
    id: "session-1",
    transport: "cookie",
    accessExpiresAt: "2026-10-23T12:00:00.000Z",
    refreshExpiresAt: "2026-11-23T12:00:00.000Z",
  },
};

const member: MemberListItem = {
  id: "membership-2",
  organizationId: "org-1",
  userId: "employee-1",
  role: "EMPLOYEE",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  user: {
    id: "employee-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    status: "ACTIVE",
  },
};

function correction(id: string, overrides: Partial<AttendanceCorrection> = {}): AttendanceCorrection {
  return {
    id,
    organizationId: "org-1",
    employeeId: "employee-1",
    timeSessionId: null,
    requestType: "CREATE_SESSION",
    workDate: "2026-10-22",
    requestedStartedAt: "2026-10-22T09:00:00.000Z",
    requestedEndedAt: "2026-10-22T17:00:00.000Z",
    requestedBreaks: [],
    requestedBreakSeconds: 0,
    reason: "Missing session.",
    status: "PENDING",
    original: null,
    applied: null,
    resultingSessionId: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewerNote: null,
    rejectionReason: null,
    employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
    createdAt: "2026-10-22T18:00:00.000Z",
    updatedAt: "2026-10-22T18:00:00.000Z",
    ...overrides,
  };
}

function list(rows: AttendanceCorrection[]) {
  return {
    data: rows,
    meta: { page: 1, limit: 10, total: rows.length, totalPages: 1 },
    serverTime: "2026-10-23T10:00:00.000Z",
  };
}

function respond(rows: AttendanceCorrection[]) {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path.endsWith("/members")) {
      return { data: [member], meta: { page: 1, limit: 100, total: 1, totalPages: 1 } };
    }
    if (path.endsWith("/attendance/corrections") && (options?.method ?? "GET") === "GET") {
      return list(rows);
    }
    if (options?.method === "POST") {
      return { data: {} };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderView() {
  return render(
    <WorkspaceProvider session={session}>
      <CorrectionReviewView />
    </WorkspaceProvider>,
  );
}

describe("CorrectionReviewView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("approves a correction with an optional note", async () => {
    const user = userEvent.setup();
    respond([correction("corr-1")]);
    renderView();

    await screen.findByText(/Ada Lovelace · ada@example.com/);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.type(screen.getByLabelText("Reviewer note"), "Confirmed with the employee.");
    await user.click(screen.getByRole("button", { name: "Confirm approval" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/attendance/corrections/corr-1/approve",
        { method: "POST", body: { note: "Confirmed with the employee." } },
      );
    });
    expect(await screen.findByText("Correction approved and attendance updated.")).toBeInTheDocument();
  });

  it("requires a rejection reason before sending the request", async () => {
    const user = userEvent.setup();
    respond([correction("corr-2")]);
    renderView();

    await screen.findByText(/Ada Lovelace · ada@example.com/);
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText(/Rejection reason/), "no");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    expect(
      await screen.findByText("Enter a rejection reason with at least 3 characters."),
    ).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(
        ([path]) => path === "/organizations/org-1/attendance/corrections/corr-2/reject",
      ),
    ).toBe(false);

    await user.clear(screen.getByLabelText(/Rejection reason/));
    await user.type(screen.getByLabelText(/Rejection reason/), "Duplicate request.");
    await user.click(screen.getByRole("button", { name: "Confirm rejection" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/attendance/corrections/corr-2/reject",
        { method: "POST", body: { reason: "Duplicate request." } },
      );
    });
    expect(await screen.findByText("Correction rejected.")).toBeInTheDocument();
  });

  it("blocks self-review in the review queue", async () => {
    respond([correction("corr-3", { employeeId: "reviewer-1" })]);
    renderView();

    expect(
      await screen.findByText(/You cannot review your own correction request/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
