import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RolesView } from "@/components/roles-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type { Permission } from "@/lib/permissions";
import type {
  MemberListItem,
  Organization,
  PermissionCatalog,
  Role,
  RoleSummary,
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

function sessionFor(role: Role, permissions?: Permission[]): SessionData {
  return {
    platformRole: null,
    user: {
      id: "admin-1",
      name: "Admin User",
      email: "admin@example.com",
      status: "ACTIVE",
      lastLoginAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    memberships: [
      {
        id: "membership-1",
        organizationId: organization.id,
        userId: "admin-1",
        role,
        ...(permissions ? { permissions } : {}),
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
}

const catalog: PermissionCatalog = {
  permissions: [
    {
      id: "time:read",
      group: "time",
      label: "View time",
      description: "Read tracked time sessions.",
      grantableToCustomRole: true,
      grantableToManager: true,
    },
    {
      id: "leave:read",
      group: "leave",
      label: "View leave",
      description: "View leave requests and balances.",
      grantableToCustomRole: true,
      grantableToManager: true,
    },
    {
      id: "member:onboard",
      group: "people",
      label: "Invite and onboard employees",
      description:
        "Invite new employees to this organization without granting administrative access.",
      grantableToCustomRole: true,
      grantableToManager: true,
    },
    {
      id: "role:manage",
      group: "organization",
      label: "Manage roles",
      description: "Create, edit, delete, and assign custom roles.",
      grantableToCustomRole: false,
      grantableToManager: false,
    },
    {
      id: "screenshot:read",
      group: "screenshot",
      label: "View screenshots",
      description: "View captured screenshots for the organization.",
      grantableToCustomRole: false,
      grantableToManager: true,
    },
  ],
  groups: [
    { key: "time", label: "Time tracking", permissions: ["time:read"] },
    { key: "leave", label: "Leave", permissions: ["leave:read"] },
    { key: "people", label: "People & Onboarding", permissions: ["member:onboard"] },
  ],
  grantable: ["time:read", "leave:read", "member:onboard"],
  grantableManager: ["time:read", "leave:read", "member:onboard", "screenshot:read"],
  protected: ["role:manage", "screenshot:read"],
  dataScopes: [
    {
      value: "SELF",
      label: "Own records only",
      description:
        "Users can access their own attendance, time tracking, leave, and reports where supported.",
    },
    {
      value: "ORGANIZATION",
      label: "All organization records",
      description:
        "Users can access records belonging to other employees in this organization, but only for features they have permission to view.",
    },
  ],
  dataScopeNote:
    "This never grants access to another organization or automatically provides editing or administrative permissions.",
};

function roleSummaries(assignedUserCount = 2, managerCustomized = false): RoleSummary[] {
  return [
    {
      id: "OWNER",
      key: "OWNER",
      name: "Owner",
      description: "Full organization control.",
      builtIn: true,
      customizable: false,
      customized: false,
      permissions: ["time:read", "leave:read"],
      permissionCount: 2,
      dataScope: "ORGANIZATION",
      onboardingEligible: false,
      assignedUserCount: 1,
      createdAt: null,
      updatedAt: null,
    },
    {
      id: "MANAGER",
      key: "MANAGER",
      name: "Manager",
      description: managerCustomized ? "Customized team oversight." : "Team oversight.",
      builtIn: true,
      customizable: true,
      customized: managerCustomized,
      permissions: managerCustomized
        ? ["time:read", "screenshot:read"]
        : ["time:read", "leave:read", "screenshot:read"],
      permissionCount: managerCustomized ? 2 : 3,
      dataScope: "ORGANIZATION",
      onboardingEligible: false,
      assignedUserCount: 2,
      createdAt: null,
      updatedAt: managerCustomized ? "2026-10-01T00:00:00.000Z" : null,
    },
    {
      id: "EMPLOYEE",
      key: "EMPLOYEE",
      name: "Employee",
      description: "Personal self-service.",
      builtIn: true,
      customizable: false,
      customized: false,
      permissions: ["time:read"],
      permissionCount: 1,
      dataScope: "SELF",
      onboardingEligible: false,
      assignedUserCount: 5,
      createdAt: null,
      updatedAt: null,
    },
    {
      id: "role-1",
      key: "role-1",
      name: "Support lead",
      description: "Reads time and leave without admin controls.",
      builtIn: false,
      customizable: false,
      customized: false,
      permissions: ["time:read", "leave:read"],
      permissionCount: 2,
      dataScope: "SELF",
      onboardingEligible: true,
      assignedUserCount,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    },
  ];
}

const member: MemberListItem = {
  id: "membership-2",
  organizationId: organization.id,
  userId: "user-2",
  role: "EMPLOYEE",
  customRoleId: "role-1",
  status: "ACTIVE",
  permissions: ["time:read"],
  dataScope: "SELF",
  createdAt: "2026-02-02T00:00:00.000Z",
  updatedAt: "2026-02-02T00:00:00.000Z",
  user: {
    id: "user-2",
    name: "Sam Lee",
    email: "sam@example.com",
    status: "ACTIVE",
  },
};

function respond(
  options: {
    assignedUserCount?: number;
    managerCustomized?: boolean;
    deleteError?: ApiError;
  } = {},
) {
  const roles = () => roleSummaries(options.assignedUserCount, options.managerCustomized);
  const custom = () => roles().find((role) => role.id === "role-1")!;
  const manager = () => roles().find((role) => role.id === "MANAGER")!;

  mockedApiRequest.mockImplementation(async (path, requestOptions) => {
    if (path === "/organizations/org-1/roles" && requestOptions?.method === "POST") {
      return {
        data: {
          role: {
            ...custom(),
            id: "role-2",
            key: "role-2",
            name: "New role",
            permissions: ["time:read"],
            permissionCount: 1,
          },
        },
      };
    }
    if (path === "/organizations/org-1/roles") {
      return { data: roles() };
    }
    if (path === "/organizations/org-1/roles/permissions") {
      return { data: catalog };
    }
    if (
      path === "/organizations/org-1/roles/MANAGER" &&
      requestOptions?.method === "PATCH"
    ) {
      return {
        data: {
          role: {
            ...manager(),
            customized: true,
            permissions: (requestOptions.body as { permissions?: RoleSummary["permissions"] })
              ?.permissions ?? manager().permissions,
          },
        },
      };
    }
    if (
      path === "/organizations/org-1/roles/MANAGER" &&
      requestOptions?.method === "DELETE"
    ) {
      return { data: { role: { ...manager(), customized: false } } };
    }
    if (path === "/organizations/org-1/roles/MANAGER/users") {
      return {
        data: [member],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
    }
    if (path === "/organizations/org-1/roles/role-1" && requestOptions?.method === "PATCH") {
      return {
        data: {
          role: { ...custom(), permissions: ["time:read"] },
        },
      };
    }
    if (path === "/organizations/org-1/roles/role-1" && requestOptions?.method === "DELETE") {
      if (options.deleteError) throw options.deleteError;
      return undefined;
    }
    if (path === "/organizations/org-1/roles/role-1/users") {
      return {
        data: [member],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      };
    }
    throw new Error(`Unexpected request: ${path} ${requestOptions?.method ?? "GET"}`);
  });
}

function renderView(role: Role = "OWNER", permissions?: Permission[]) {
  return render(
    <WorkspaceProvider session={sessionFor(role, permissions)}>
      <RolesView />
    </WorkspaceProvider>,
  );
}

describe("RolesView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("distinguishes protected, customizable, and custom roles", async () => {
    respond();
    renderView();

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Support lead")).toBeInTheDocument();
    expect(within(table).getAllByText("Built-in · Protected")).toHaveLength(2);
    expect(within(table).getByText("Built-in · Customizable")).toBeInTheDocument();
    expect(within(table).getByText("Custom")).toBeInTheDocument();
    expect(within(table).getAllByText("Own records only")).toHaveLength(2);
    expect(within(table).getAllByText("All organization records")).toHaveLength(2);
    expect(within(table).getAllByText("2 users")).toHaveLength(2);
    expect(within(table).getAllByText("Read-only")).toHaveLength(2);
    expect(within(table).getAllByRole("button", { name: "Edit" })).toHaveLength(2);
    expect(within(table).getAllByRole("button", { name: "Delete" })).toHaveLength(1);
    expect(within(table).getAllByRole("button", { name: "Users" })).toHaveLength(2);
  });

  it("keeps role administration read-only without role:manage", async () => {
    respond();
    renderView("EMPLOYEE", ["role:read"]);

    expect(
      await screen.findByText(
        /only the organization owner can customize the Manager role/i,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create role" })).not.toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("button", { name: "Users" })).toHaveLength(2);
    expect(within(table).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("validates the role form and never offers protected permissions", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Create role" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Create role" }));
    expect(
      within(dialog).getByText("The role name must be between 2 and 80 characters."),
    ).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/^Role name/), "Shift lead");
    await user.click(within(dialog).getByRole("button", { name: "Create role" }));
    expect(
      within(dialog).getByText("Select at least one permission for the role."),
    ).toBeInTheDocument();

    expect(within(dialog).getByRole("checkbox", { name: /Manage roles/ })).toBeDisabled();
    expect(within(dialog).getByRole("checkbox", { name: /View time/ })).toBeEnabled();
    expect(
      mockedApiRequest.mock.calls.some(
        ([path, options]) =>
          path === "/organizations/org-1/roles" && options?.method === "POST",
      ),
    ).toBe(false);
  });

  it("creates a role with the selected permissions and scope", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Create role" }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/^Role name/), "Shift lead");
    await user.type(
      within(dialog).getByLabelText("Description"),
      "Delegated shift oversight.",
    );
    await user.click(within(dialog).getByRole("checkbox", { name: /View time/ }));
    await user.selectOptions(
      within(dialog).getByLabelText(/^Data access scope/),
      "ORGANIZATION",
    );
    expect(
      within(dialog).getByText(
        /Users can access records belonging to other employees in this organization/,
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/never grants access to another organization/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create role" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/roles",
        expect.objectContaining({
          method: "POST",
          body: {
            name: "Shift lead",
            description: "Delegated shift oversight.",
            permissions: ["time:read"],
            dataScope: "ORGANIZATION",
            onboardingEligible: false,
          },
        }),
      );
    });
    expect(await screen.findByText("Shift lead was created.")).toBeInTheDocument();
  });

  it("warns before removing permissions that users rely on", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Support lead").closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Edit" }));

    const editor = screen.getByRole("dialog");
    await user.click(within(editor).getByRole("checkbox", { name: /View leave/ }));
    await user.click(within(editor).getByRole("button", { name: "Save changes" }));

    expect(
      screen.getByRole("heading", { name: "Remove permissions from a role in use?" }),
    ).toBeInTheDocument();
    const dialogs = screen.getAllByRole("dialog");
    const confirm = dialogs[dialogs.length - 1];
    expect(within(confirm).getByText("View leave")).toBeInTheDocument();

    const confirmButtons = screen.getAllByRole("button", { name: "Save changes" });
    await user.click(confirmButtons[confirmButtons.length - 1]);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/roles/role-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({ permissions: ["time:read"] }),
        }),
      );
    });
  });

  it("shows assigned users for a custom role", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Support lead").closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Users" }));

    expect(await screen.findByText("Sam Lee")).toBeInTheDocument();
    expect(screen.getByText("sam@example.com")).toBeInTheDocument();
    expect(
      mockedApiRequest.mock.calls.some(
        ([path, options]) =>
          path === "/organizations/org-1/roles/role-1/users" &&
          options?.query?.limit === 20,
      ),
    ).toBe(true);
  });

  it("deletes a custom role only after confirmation", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Delete" }));

    expect(
      screen.getByRole("heading", { name: "Delete Support lead?" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete role" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/roles/role-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(await screen.findByText("Support lead was deleted.")).toBeInTheDocument();
  });

  it("keeps the delete dialog open and explains when a role is in use", async () => {
    const user = userEvent.setup();
    respond({
      assignedUserCount: 2,
      deleteError: new ApiError({
        status: 409,
        code: "ROLE_IN_USE",
        message:
          "This role is assigned to 2 users. Reassign them before deleting it.",
      }),
    });
    renderView();

    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Delete role" }));

    expect(
      await screen.findByText(
        "This role is assigned to 2 users. Reassign them before deleting it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Delete Support lead?" }),
    ).toBeInTheDocument();
  });

  it("lets the owner customize the Manager role with a removal confirmation", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Manager").closest("tr") as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Edit" }));

    const editor = screen.getByRole("dialog");
    expect(
      within(editor).getByRole("heading", { name: "Customize Manager role" }),
    ).toBeInTheDocument();
    expect(within(editor).queryByLabelText(/^Role name/)).not.toBeInTheDocument();

    await user.click(within(editor).getByRole("checkbox", { name: /View leave/ }));
    await user.click(within(editor).getByRole("button", { name: "Save changes" }));

    expect(
      screen.getByRole("heading", { name: "Remove permissions from the Manager role?" }),
    ).toBeInTheDocument();
    const dialogs = screen.getAllByRole("dialog");
    const confirm = dialogs[dialogs.length - 1];
    expect(within(confirm).getByText("View leave")).toBeInTheDocument();

    const buttons = screen.getAllByRole("button", { name: "Save changes" });
    await user.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/roles/MANAGER",
        {
          method: "PATCH",
          body: {
            description: "Team oversight.",
            permissions: ["time:read", "screenshot:read"],
            dataScope: "ORGANIZATION",
          },
        },
      );
    });
    expect(await screen.findByText("Manager role was updated.")).toBeInTheDocument();
  });

  it("keeps the Manager role read-only for administrators", async () => {
    respond();
    renderView("ADMIN");

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Manager").closest("tr") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Users" })).toBeInTheDocument();
  });

  it("restores default Manager permissions for the owner", async () => {
    const user = userEvent.setup();
    respond({ managerCustomized: true });
    renderView();

    const table = await screen.findByRole("table");
    const row = within(table).getByText("Manager").closest("tr") as HTMLElement;
    expect(within(row).getByText("Customized")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Restore defaults" }));

    expect(
      screen.getByRole("heading", { name: "Restore the default Manager role?" }),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole("button", { name: "Restore defaults" });
    await user.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/roles/MANAGER",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(await screen.findByText("Manager role restored to defaults.")).toBeInTheDocument();
  });

  it("supports onboarding eligibility for custom roles", async () => {
    const user = userEvent.setup();
    respond();
    renderView();

    await screen.findByRole("table");
    await user.click(screen.getByRole("button", { name: "Create role" }));
    const dialog = screen.getByRole("dialog");

    await user.type(within(dialog).getByLabelText(/^Role name/), "Onboarding agent");
    await user.click(
      within(dialog).getByRole("checkbox", { name: /^Invite and onboard employees/ }),
    );
    await user.click(
      within(dialog).getByRole("checkbox", { name: /^Allow this role to invite/ }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Create role" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/roles",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            permissions: ["member:onboard"],
            onboardingEligible: true,
            dataScope: "SELF",
          }),
        }),
      );
    });
  });
});
