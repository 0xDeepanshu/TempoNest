import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CorrectionReviewCard } from "@/components/correction-review-view";
import type { AttendanceCorrection } from "@/lib/types";

const baseCorrection: AttendanceCorrection = {
  id: "corr-1",
  organizationId: "org-1",
  employeeId: "employee-1",
  timeSessionId: "session-1",
  requestType: "UPDATE_SESSION",
  workDate: "2026-10-22",
  requestedStartedAt: "2026-10-22T07:00:00.000Z",
  requestedEndedAt: "2026-10-22T15:00:00.000Z",
  requestedBreaks: [
    {
      startedAt: "2026-10-22T09:00:00.000Z",
      endedAt: "2026-10-22T09:30:00.000Z",
      durationSeconds: 1_800,
    },
  ],
  requestedBreakSeconds: 1_800,
  reason: "The timer started late after an update.",
  status: "PENDING",
  original: {
    sessionId: "session-1",
    startedAt: "2026-10-22T07:15:00.000Z",
    endedAt: "2026-10-22T15:00:00.000Z",
    breaks: [
      { startedAt: "2026-10-22T09:00:00.000Z", endedAt: "2026-10-22T09:30:00.000Z" },
    ],
  },
  applied: null,
  resultingSessionId: null,
  reviewedByUserId: null,
  reviewedAt: null,
  reviewerNote: null,
  rejectionReason: null,
  employee: { id: "employee-1", name: "Ada Lovelace", email: "ada@example.com" },
  createdAt: "2026-10-22T16:00:00.000Z",
  updatedAt: "2026-10-22T16:00:00.000Z",
};

function renderCard(
  overrides: Partial<AttendanceCorrection> = {},
  currentUserId = "reviewer-1",
) {
  const onSubmit = vi.fn();
  const onOpen = vi.fn();
  const onClose = vi.fn();

  render(
    <CorrectionReviewCard
      correction={{ ...baseCorrection, ...overrides }}
      timezone="UTC"
      currentUserId={currentUserId}
      busy={false}
      action={null}
      note=""
      rejectReason=""
      actionError={null}
      onOpen={onOpen}
      onClose={onClose}
      onSubmit={onSubmit}
      onNoteChange={() => {}}
      onRejectReasonChange={() => {}}
    />,
  );

  return { onSubmit, onOpen, onClose };
}

describe("CorrectionReviewCard", () => {
  it("shows the request details and lets a reviewer start an approval", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderCard();

    expect(screen.getByText("2026-10-22")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace · ada@example.com")).toBeInTheDocument();
    expect(screen.getByText(/The timer started late after an update\./)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(onOpen).toHaveBeenCalledWith("approve");
  });

  it("does not offer review actions on a request owned by the reviewer", () => {
    renderCard({ employeeId: "reviewer-1" }, "reviewer-1");

    expect(
      screen.getByText(/You cannot review your own correction request/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("renders the approval confirmation panel", () => {
    render(
      <CorrectionReviewCard
        correction={baseCorrection}
        timezone="UTC"
        currentUserId="reviewer-1"
        busy={false}
        action={{ correctionId: "corr-1", type: "approve" }}
        note="Looks right."
        rejectReason=""
        actionError={null}
        onOpen={() => {}}
        onClose={() => {}}
        onSubmit={() => {}}
        onNoteChange={() => {}}
        onRejectReasonChange={() => {}}
      />,
    );

    expect(screen.getByText("Approve correction")).toBeInTheDocument();
    expect(screen.getByLabelText("Reviewer note")).toHaveValue("Looks right.");
    expect(screen.getByRole("button", { name: "Confirm approval" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Rejection reason")).not.toBeInTheDocument();
  });

  it("requires a rejection reason and surfaces action errors", () => {
    render(
      <CorrectionReviewCard
        correction={baseCorrection}
        timezone="UTC"
        currentUserId="reviewer-1"
        busy={false}
        action={{ correctionId: "corr-1", type: "reject" }}
        note=""
        rejectReason=""
        actionError="Enter a rejection reason with at least 3 characters."
        onOpen={() => {}}
        onClose={() => {}}
        onSubmit={() => {}}
        onNoteChange={() => {}}
        onRejectReasonChange={() => {}}
      />,
    );

    expect(screen.getByLabelText(/Rejection reason/)).toBeInTheDocument();
    expect(
      screen.getByText("Enter a rejection reason with at least 3 characters."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm rejection" })).toBeInTheDocument();
  });

  it("hides the review panel once a correction is decided", () => {
    renderCard({ status: "APPROVED", reviewerNote: "Approved." });

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.getByText("Note: Approved.")).toBeInTheDocument();
  });
});
