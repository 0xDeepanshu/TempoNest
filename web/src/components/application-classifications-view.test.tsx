import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationClassificationsView } from "@/components/application-classifications-view";
import { WorkspaceProvider } from "@/components/workspace";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type {
  ApplicationClassificationsResponse,
  Organization,
  Role,
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

const catalog: ApplicationClassificationsResponse = {
  data: [
    {
      classificationId: "class-1",
      applicationIdentifier: "code",
      applicationName: "Visual Studio Code",
      category: "PRODUCTIVE",
      classified: true,
      classifiedByUserId: "admin-1",
      notes: "Primary editor",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: "2026-10-02T00:00:00.000Z",
    },
    {
      classificationId: null,
      applicationIdentifier: "mystery",
      applicationName: "Mystery App",
      category: "UNCLASSIFIED",
      classified: false,
      classifiedByUserId: null,
      notes: null,
      createdAt: null,
      updatedAt: null,
    },
  ],
  meta: { page: 1, limit: 20, total: 2, totalPages: 2 },
  summary: { total: 2, classified: 1, unclassified: 1 },
};

function mockCatalog() {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (
      path === "/organizations/org-1/application-classifications" &&
      (options?.method ?? "GET") === "GET"
    ) {
      return catalog;
    }
    if (
      path === "/organizations/org-1/application-classifications" &&
      options?.method === "POST"
    ) {
      return {
        data: {
          classification: {
            id: "class-2",
            organizationId: "org-1",
            applicationIdentifier: "slack",
            applicationName: "Slack",
            category: "NEUTRAL",
            classified: true,
            classifiedByUserId: "admin-1",
            notes: "Team chat",
            createdAt: "2026-10-30T12:00:00.000Z",
            updatedAt: "2026-10-30T12:00:00.000Z",
          },
        },
        serverTime: "2026-10-30T12:00:00.000Z",
      };
    }
    if (
      path === "/organizations/org-1/application-classifications/class-1" &&
      options?.method === "PATCH"
    ) {
      return {
        data: {
          classification: {
            id: "class-1",
            organizationId: "org-1",
            applicationIdentifier: "code",
            applicationName: "Visual Studio Code",
            category: "NEUTRAL",
            classified: true,
            classifiedByUserId: "admin-1",
            notes: "Primary editor",
            createdAt: "2026-10-01T00:00:00.000Z",
            updatedAt: "2026-10-30T12:00:00.000Z",
          },
        },
        serverTime: "2026-10-30T12:00:00.000Z",
      };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderCatalog(role: Role = "ADMIN") {
  return render(
    <WorkspaceProvider session={sessionFor(role)}>
      <ApplicationClassificationsView />
    </WorkspaceProvider>,
  );
}

describe("ApplicationClassificationsView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("lists catalog entries and observed applications without inventing categories", async () => {
    mockCatalog();
    renderCatalog();

    expect(await screen.findByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getByText("Mystery App")).toBeInTheDocument();
    expect(screen.getByText("Observed · not in catalog")).toBeInTheDocument();
    expect(screen.getAllByText("Classified").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Add classification" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Classify" })).toBeInTheDocument();
  });

  it("applies search, category, observed, and pagination queries", async () => {
    mockCatalog();
    renderCatalog();
    const user = userEvent.setup();

    await screen.findByText("Visual Studio Code");
    await user.type(screen.getByLabelText("Search applications"), "code");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/application-classifications",
        expect.objectContaining({
          query: expect.objectContaining({ q: "code", page: 1 }),
        }),
      );
    });

    await user.selectOptions(screen.getByLabelText("Category"), "PRODUCTIVE");
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/application-classifications",
        expect.objectContaining({
          query: expect.objectContaining({ category: "PRODUCTIVE", page: 1 }),
        }),
      );
    });

    await user.click(screen.getByRole("checkbox", { name: "Include observed apps" }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/application-classifications",
        expect.objectContaining({
          query: expect.objectContaining({ includeObserved: false }),
        }),
      );
    });

    await user.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/application-classifications",
        expect.objectContaining({
          query: expect.objectContaining({ page: 2 }),
        }),
      );
    });
  });

  it("creates a new classification through the API", async () => {
    mockCatalog();
    renderCatalog();
    const user = userEvent.setup();

    await screen.findByText("Visual Studio Code");
    await user.click(screen.getByRole("button", { name: "Add classification" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Application identifier/), "slack");
    await user.type(within(dialog).getByLabelText(/Display name/), "Slack");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "NEUTRAL");
    await user.type(within(dialog).getByLabelText(/Notes/), "Team chat");
    await user.click(within(dialog).getByRole("button", { name: "Add classification" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/application-classifications",
        expect.objectContaining({
          method: "POST",
          body: {
            applicationIdentifier: "slack",
            applicationName: "Slack",
            category: "NEUTRAL",
            notes: "Team chat",
          },
        }),
      );
    });
    expect(
      await screen.findByText(/Slack added to the catalog/),
    ).toBeInTheDocument();
  });

  it("classifies an observed application with a create request", async () => {
    mockCatalog();
    renderCatalog();
    const user = userEvent.setup();

    await screen.findByText("Mystery App");
    await user.click(screen.getByRole("button", { name: "Classify" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText(/Application identifier/)).toBeDisabled();
    await user.selectOptions(within(dialog).getByLabelText("Category"), "NEUTRAL");
    await user.click(within(dialog).getByRole("button", { name: "Save classification" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/application-classifications",
        expect.objectContaining({
          method: "POST",
          body: {
            applicationIdentifier: "mystery",
            applicationName: "Mystery App",
            category: "NEUTRAL",
            notes: null,
          },
        }),
      );
    });
    expect(
      await screen.findByText(/Mystery App added to the catalog/),
    ).toBeInTheDocument();
  });

  it("updates an existing classification and explains retroactive grouping", async () => {
    mockCatalog();
    renderCatalog();
    const user = userEvent.setup();

    await screen.findByText("Visual Studio Code");
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Category"), "NEUTRAL");
    await user.click(within(dialog).getByRole("button", { name: "Save classification" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/organizations/org-1/application-classifications/class-1",
        expect.objectContaining({
          method: "PATCH",
          body: {
            applicationName: "Visual Studio Code",
            category: "NEUTRAL",
            notes: "Primary editor",
          },
        }),
      );
    });
    expect(
      await screen.findByText(/Visual Studio Code updated/),
    ).toBeInTheDocument();
  });

  it("shows API errors inside the editor without closing it", async () => {
    mockedApiRequest.mockImplementation(async (path, options) => {
      if (
        path === "/organizations/org-1/application-classifications" &&
        (options?.method ?? "GET") === "GET"
      ) {
        return catalog;
      }
      throw new ApiError({
        status: 409,
        code: "CLASSIFICATION_EXISTS",
        message: "This application already has a classification in this organization",
      });
    });
    renderCatalog();
    const user = userEvent.setup();

    await screen.findByText("Visual Studio Code");
    await user.click(screen.getByRole("button", { name: "Add classification" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText(/Application identifier/), "code");
    await user.click(within(dialog).getByRole("button", { name: "Add classification" }));

    expect(
      await within(dialog).findByText(
        "This application already has a classification in this organization",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows a read-only catalog to managers", async () => {
    mockCatalog();
    renderCatalog("MANAGER");

    expect(await screen.findByText("Read-only catalog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add classification" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Classify" })).not.toBeInTheDocument();
  });
});
