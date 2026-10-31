import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvitationAcceptView } from "@/components/invitation-accept-view";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { MembershipSummary, Organization, PublicUser, Role } from "@/lib/types";

const { token, replace, refresh } = vi.hoisted(() => ({
  token: "t".repeat(40),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => new URLSearchParams(`token=${"t".repeat(40)}`),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const organization: Organization = {
  id: "org-1",
  name: "TempoNest Labs",
  slug: "temponest-labs",
  status: "ACTIVE",
  timezone: "UTC",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const user: PublicUser = {
  id: "user-1",
  name: "Ada Lovelace",
  email: "ada@example.com",
  status: "ACTIVE",
  lastLoginAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const membership: MembershipSummary = {
  id: "membership-1",
  organizationId: organization.id,
  userId: user.id,
  role: "EMPLOYEE",
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

interface PreviewOverrides {
  name?: string | null;
  role?: Role;
  customRole?: { id: string; name: string } | null;
  existingAccount?: boolean;
  signedInEmail?: string | null;
  signedInMatches?: boolean;
}

function preview(overrides: PreviewOverrides = {}) {
  return {
    organization,
    name: "Ada Lovelace",
    email: "ada@example.com",
    role: "EMPLOYEE" as Role,
    customRole: null,
    expiresAt: "2026-11-06T00:00:00.000Z",
    existingAccount: false,
    signedInEmail: null,
    signedInMatches: false,
    ...overrides,
  };
}

function mockPreview(invitation: ReturnType<typeof preview>) {
  mockedApiRequest.mockImplementation(async (path) => {
    if (path === "/invitations/preview") {
      return { data: { invitation } };
    }
    if (path === "/invitations/accept") {
      return {
        data: {
          membership,
          organization,
          user,
          accountCreated: !invitation.existingAccount,
          session: invitation.existingAccount ? null : { id: "session-1" },
        },
      };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

describe("InvitationAcceptView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    replace.mockReset();
    refresh.mockReset();
    window.localStorage.clear();
  });

  it("shows the invited name, organization, and role before account creation", async () => {
    mockPreview(preview());
    render(<InvitationAcceptView />);

    expect(await screen.findByText("TempoNest Labs")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Employee")).toBeInTheDocument();
    expect(screen.getByLabelText("Invited email")).toHaveValue("ada@example.com");
  });

  it("creates the account with the chosen password and signs in", async () => {
    const userEventApi = userEvent.setup();
    mockPreview(preview());
    render(<InvitationAcceptView />);

    await userEventApi.type(await screen.findByLabelText(/^Create password/), "a-strong-password");
    await userEventApi.type(screen.getByLabelText(/^Confirm password/), "a-strong-password");
    await userEventApi.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith("/invitations/accept", {
        method: "POST",
        body: { token, password: "a-strong-password" },
      });
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(window.localStorage.getItem("temponest.organization")).toBe("org-1");
  });

  it("blocks submission when the password confirmation does not match", async () => {
    const userEventApi = userEvent.setup();
    mockPreview(preview());
    render(<InvitationAcceptView />);

    await userEventApi.type(await screen.findByLabelText(/^Create password/), "a-strong-password");
    await userEventApi.type(screen.getByLabelText(/^Confirm password/), "different-password");
    await userEventApi.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(([path]) => path === "/invitations/accept"),
    ).toBe(false);
  });

  it("asks an existing user to sign in instead of setting a password", async () => {
    mockPreview(preview({ existingAccount: true }));
    render(<InvitationAcceptView />);

    expect(await screen.findByText("You already have a TempoNest account")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to accept" })).toHaveAttribute(
      "href",
      `/login?next=${encodeURIComponent(`/invitations/accept?token=${token}`)}`,
    );
    expect(screen.queryByLabelText(/^Create password/)).not.toBeInTheDocument();
  });

  it("accepts without a password when the invited account is signed in", async () => {
    const userEventApi = userEvent.setup();
    mockPreview(
      preview({
        existingAccount: true,
        signedInEmail: "ada@example.com",
        signedInMatches: true,
      }),
    );
    render(<InvitationAcceptView />);

    await userEventApi.click(
      await screen.findByRole("button", { name: "Accept invitation" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith("/invitations/accept", {
        method: "POST",
        body: { token },
      });
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
  });

  it("warns when a different account is signed in", async () => {
    mockPreview(
      preview({ existingAccount: true, signedInEmail: "someone.else@example.com" }),
    );
    render(<InvitationAcceptView />);

    expect(await screen.findByText("Wrong account is signed in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Create password/)).not.toBeInTheDocument();
  });

  it("shows the custom role attached to the invitation", async () => {
    mockPreview(preview({ customRole: { id: "role-1", name: "Onboarding coordinator" } }));
    render(<InvitationAcceptView />);

    expect(await screen.findByText("Onboarding coordinator")).toBeInTheDocument();
    expect(screen.queryByText("Employee")).not.toBeInTheDocument();
  });

  it("explains an expired invitation", async () => {
    mockedApiRequest.mockRejectedValue(
      new ApiError({
        status: 410,
        code: "INVITATION_EXPIRED",
        message: "This invitation has expired",
      }),
    );
    render(<InvitationAcceptView />);

    expect(
      await screen.findByText(/This invitation has expired\. Ask an administrator/),
    ).toBeInTheDocument();
  });
});
