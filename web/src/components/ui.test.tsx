import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CorrectionStatusBadge, RoleBadge, StatusBadge } from "@/components/ui";

describe("status badges", () => {
  it("maps correction statuses to human labels", () => {
    const { rerender } = render(<CorrectionStatusBadge status="PENDING" />);
    expect(screen.getByText("Pending")).toBeInTheDocument();

    rerender(<CorrectionStatusBadge status="APPROVED" />);
    expect(screen.getByText("Approved")).toBeInTheDocument();

    rerender(<CorrectionStatusBadge status="REJECTED" />);
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });

  it("maps tracking states and falls back to the raw value", () => {
    const { rerender } = render(<StatusBadge status="WORKING" />);
    expect(screen.getByText("Working")).toBeInTheDocument();

    rerender(<StatusBadge status="ON_BREAK" />);
    expect(screen.getByText("On break")).toBeInTheDocument();

    rerender(<StatusBadge status="UNKNOWN_STATE" />);
    expect(screen.getByText("UNKNOWN_STATE")).toBeInTheDocument();
  });

  it("renders role labels", () => {
    const { rerender } = render(<RoleBadge role="OWNER" />);
    expect(screen.getByText("Owner")).toBeInTheDocument();

    rerender(<RoleBadge role="EMPLOYEE" />);
    expect(screen.getByText("Employee")).toBeInTheDocument();
  });
});
