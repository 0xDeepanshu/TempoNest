import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdministrationAccessCard } from "@/components/administration-access";
import { apiRequest } from "@/lib/api-client";
import type { MemberListItem, MembershipSummary, Role } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

function actorFor(role: Role, overrides: Partial<MembershipSummary> = {}): MembershipSummary {
  return {
    id: "membership-1",
    organizationId: "org-1",
    userId: "actor-1",
    role,
    customRoleId: null,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function memberFor(overrides: Partial<MemberListItem> = {}): MemberListItem {
  return {
    id: "membership-2",
    organizationId: "org-1",
    userId: "user-2",
    role: "EMPLOYEE",
    customRoleId: null,
    status: "ACTIVE",
    createdAt: "2026-02-02T00:00:00.000Z",
    updatedAt: "2026-02-02T00:00:00.000Z",
    user: {
      id: "user-2",
      name: "Sam Lee",
      email: "sam@example.com",
      status: "ACTIVE",
    },
    ...overrides,
  };
}

function renderCard({
  actor = actorFor("OWNER"),
  member = memberFor(),
  onChanged = vi.fn(),
}: {
  actor?: MembershipSummary;
  member?: MemberListItem;
  onChanged?: () => void;
} = {}) {
  render(
    <AdministrationAccessCard
      organizationId="org-1"
      member={member}
      actor={actor}
      actorUserId={actor.userId}
      onChanged={onChanged}
    />,
  );
  return { onChanged };
}

describe("AdministrationAccessCard", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("grants administration access through the existing membership role endpoint", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValue({
      data: { membership: { id: "membership-2", role: "ADMIN", customRoleId: null } },
    });

    const { onChanged } = renderCard();

    expect(screen.getByText("Off")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn on" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/gain organization-wide administration/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Grant administration" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/members/membership-2",
        { method: "PATCH", body: { role: "ADMIN" } },
      );
    });
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText("Administration access granted.")).toBeInTheDocument();
  });

  it("revokes administration access after confirmation", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValue({
      data: { membership: { id: "membership-2", role: "EMPLOYEE", customRoleId: null } },
    });

    const { onChanged } = renderCard({ member: memberFor({ role: "ADMIN" }) });

    expect(screen.getByText("On")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Turn off" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Revoke administration" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/members/membership-2",
        { method: "PATCH", body: { role: "EMPLOYEE" } },
      );
    });
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText("Administration access revoked.")).toBeInTheDocument();
  });

  it("keeps the toggle read-only for admins, because only an owner may manage admins", () => {
    renderCard({ actor: actorFor("ADMIN") });

    expect(
      screen.getByText("Only an organization owner can grant or revoke administration access."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });

  it("does not let an owner change their own administration access", () => {
    const actor = actorFor("OWNER");
    renderCard({
      actor,
      member: memberFor({ userId: actor.userId, user: { ...memberFor().user, id: actor.userId } }),
    });

    expect(screen.getByText("You cannot change your own administration access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });

  it("keeps owner access read-only", () => {
    renderCard({ member: memberFor({ role: "OWNER" }) });

    expect(screen.getByText("Owners always have full administration access.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn off" })).not.toBeInTheDocument();
  });

  it("keeps manager roles read-only", () => {
    renderCard({ member: memberFor({ role: "MANAGER" }) });

    expect(
      screen.getByText(
        "Administration access applies to employee and administrator accounts only.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Turn on" })).not.toBeInTheDocument();
  });

  it("shows the backend error and leaves the status untouched when the save fails", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockRejectedValue(new Error("Only an owner can assign the ADMIN role"));

    const { onChanged } = renderCard();

    await user.click(screen.getByRole("button", { name: "Turn on" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Grant administration" }));

    expect(await screen.findByText("Only an owner can assign the ADMIN role")).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText("Off")).toBeInTheDocument();
  });
});
