import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationsPanel } from "@/components/organization-view";
import { apiRequest } from "@/lib/api-client";
import type {
  Invitation,
  MembershipSummary,
  Organization,
  RoleSummary,
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

function membership(
  role: MembershipSummary["role"],
  permissions?: MembershipSummary["permissions"],
): MembershipSummary {
  return {
    id: "membership-1",
    organizationId: organization.id,
    userId: "actor-1",
    role,
    customRoleId: role === "EMPLOYEE" && permissions ? "role-3" : null,
    status: "ACTIVE",
    ...(permissions ? { permissions } : {}),
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    organization,
  };
}

function role(
  overrides: Partial<RoleSummary> & Pick<RoleSummary, "id" | "name" | "builtIn">,
): RoleSummary {
  return {
    key: overrides.id,
    description: null,
    customizable: false,
    customized: false,
    permissions: [],
    permissionCount: 0,
    dataScope: "SELF",
    onboardingEligible: false,
    assignedUserCount: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

const roles: RoleSummary[] = [
  role({ id: "EMPLOYEE", name: "Employee", builtIn: true }),
  role({
    id: "role-1",
    name: "Onboarding buddy",
    builtIn: false,
    onboardingEligible: true,
  }),
  role({ id: "role-2", name: "Support lead", builtIn: false }),
];

const pendingInvitation: Invitation = {
  id: "invitation-1",
  organizationId: organization.id,
  name: "New Hire",
  email: "newhire@example.com",
  role: "EMPLOYEE",
  customRoleId: "role-1",
  customRole: { id: "role-1", name: "Onboarding buddy" },
  expiresAt: "2026-11-05T00:00:00.000Z",
  acceptedAt: null,
  revokedAt: null,
  createdAt: "2026-10-29T00:00:00.000Z",
  invitedBy: { id: "actor-1", name: "Ada Owner", email: "ada@example.com" },
};

function respond(invitations: Invitation[] = [], emailSent = true) {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path === "/organizations/org-1/roles") {
      return { data: roles };
    }
    if (path === "/organizations/org-1/invitations" && options?.method === "POST") {
      return {
        data: {
          invitation: pendingInvitation,
          token: "invitation-token",
          expiresAt: pendingInvitation.expiresAt,
          emailSent,
        },
      };
    }
    if (
      path === "/organizations/org-1/invitations/invitation-1/resend" &&
      options?.method === "POST"
    ) {
      return {
        data: {
          invitation: pendingInvitation,
          token: "rotated-invitation-token",
          expiresAt: "2026-11-10T00:00:00.000Z",
          emailSent,
        },
      };
    }
    if (path === "/organizations/org-1/invitations") {
      return {
        data: invitations,
        meta: { page: 1, limit: 10, total: invitations.length, totalPages: 1 },
      };
    }
    if (
      path === "/organizations/org-1/invitations/invitation-1" &&
      options?.method === "DELETE"
    ) {
      return undefined;
    }
    throw new Error(`Unexpected request: ${path} ${options?.method ?? "GET"}`);
  });
}

function renderPanel(actor: MembershipSummary) {
  return render(
    <InvitationsPanel
      organizationId={organization.id}
      actor={actor}
      timezone={organization.timezone}
    />,
  );
}

describe("InvitationsPanel onboarding", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("limits delegated onboarders to employee invitations", async () => {
    const user = userEvent.setup();
    respond();
    renderPanel(membership("EMPLOYEE", ["member:onboard", "member:read"]));

    expect(
      await screen.findByText(/You can invite employee-level members/i),
    ).toBeInTheDocument();
    const select = screen.getByLabelText("Role");
    expect(within(select).getAllByRole("option")).toHaveLength(1);
    expect(within(select).getByRole("option", { name: "Employee" })).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(([path]) => path === "/organizations/org-1/roles"),
    ).toBe(false);

    await user.type(screen.getByLabelText(/^Name/), "New Hire");
    await user.type(screen.getByLabelText(/^Email/), "newhire@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/invitations",
        {
          method: "POST",
          body: { name: "New Hire", email: "newhire@example.com", role: "EMPLOYEE" },
        },
      );
    });
  });

  it("offers only onboarding-eligible custom roles to an owner", async () => {
    const user = userEvent.setup();
    respond();
    renderPanel(membership("OWNER"));

    const select = await screen.findByLabelText("Role");
    await waitFor(() => {
      expect(
        within(select).getByRole("option", { name: "Onboarding buddy" }),
      ).toBeInTheDocument();
    });
    expect(
      within(select).queryByRole("option", { name: "Support lead" }),
    ).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Admin" })).toBeInTheDocument();

    await user.selectOptions(select, "custom:role-1");
    await user.type(screen.getByLabelText(/^Name/), "New Hire");
    await user.type(screen.getByLabelText(/^Email/), "newhire@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/invitations",
        {
          method: "POST",
          body: {
            name: "New Hire",
            email: "newhire@example.com",
            role: "EMPLOYEE",
            customRoleId: "role-1",
          },
        },
      );
    });
  });

  it("shows the custom role that an invitation grants", async () => {
    respond([pendingInvitation]);
    renderPanel(membership("OWNER"));

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Onboarding buddy")).toBeInTheDocument();
    expect(within(table).getByText("newhire@example.com")).toBeInTheDocument();
    expect(within(table).getByText("New Hire")).toBeInTheDocument();
  });

  it("confirms that the invitation e-mail was sent", async () => {
    const user = userEvent.setup();
    respond([], true);
    renderPanel(membership("OWNER"));

    await user.type(screen.getByLabelText(/^Name/), "New Hire");
    await user.type(screen.getByLabelText(/^Email/), "newhire@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(
      await screen.findByText(/We e-mailed an acceptance link/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Copy link/ })).not.toBeInTheDocument();
  });

  it("resends a pending invitation and exposes the delivery fallback link", async () => {
    const user = userEvent.setup();
    respond([pendingInvitation], false);
    renderPanel(membership("OWNER"));

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Resend" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/invitations/invitation-1/resend",
        { method: "POST", body: {} },
      );
    });
    expect(
      await screen.findByText(/The e-mail could not be sent/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("/invitations/accept?token=rotated-invitation-token"),
    ).toBeInTheDocument();
  });

  it("requires a name before sending an invitation", async () => {
    const user = userEvent.setup();
    respond();
    renderPanel(membership("OWNER"));

    await user.type(screen.getByLabelText(/^Email/), "newhire@example.com");
    await user.click(screen.getByRole("button", { name: "Invite" }));

    expect(
      await screen.findByText(/Enter the invitee's name/),
    ).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(
        ([path, options]) =>
          path === "/organizations/org-1/invitations" && options?.method === "POST",
      ),
    ).toBe(false);
  });
});
