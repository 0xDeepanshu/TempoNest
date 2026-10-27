import type { AnchorHTMLAttributes, ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuperadminOrganizationsView } from "@/components/superadmin-organizations-view";
import { apiRequest } from "@/lib/api-client";
import type { Paginated, PlatformOrganization } from "@/lib/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const acmeId = "11111111-1111-4111-8111-111111111111";
const betaId = "22222222-2222-4222-8222-222222222222";
const gammaId = "33333333-3333-4333-8333-333333333333";

function organization(
  overrides: Partial<PlatformOrganization> & Pick<PlatformOrganization, "id" | "name" | "slug">,
): PlatformOrganization {
  return {
    status: "ACTIVE",
    timezone: "UTC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    memberCount: 0,
    activeMemberCount: 0,
    ...overrides,
  };
}

const acme = organization({
  id: acmeId,
  name: "Acme",
  slug: "acme",
  memberCount: 5,
  activeMemberCount: 4,
});
const beta = organization({
  id: betaId,
  name: "Beta",
  slug: "beta",
  status: "SUSPENDED",
  memberCount: 3,
  activeMemberCount: 2,
});
const gamma = organization({
  id: gammaId,
  name: "Gamma",
  slug: "gamma",
  status: "DELETED",
  deletedAt: "2026-10-01T00:00:00.000Z",
  memberCount: 1,
  activeMemberCount: 0,
});

function page(
  rows: PlatformOrganization[],
  meta: Partial<Paginated<PlatformOrganization>["meta"]> = {},
): Paginated<PlatformOrganization> {
  return {
    data: rows,
    meta: {
      page: 1,
      limit: 20,
      total: rows.length,
      totalPages: 1,
      ...meta,
    },
  };
}

type Query = Record<string, string | number | boolean | null | undefined>;

function queryValue(query: Query | undefined, key: string) {
  return query?.[key];
}

function installApi(overrides?: {
  list?: (rows: PlatformOrganization[], query: Query | undefined) => Paginated<PlatformOrganization>;
}) {
  mockedApiRequest.mockImplementation(async (path, options) => {
    if (path === "/platform/overview") {
      return { data: { total: 3, active: 1, suspended: 1, deleted: 1 } };
    }
    if (
      (path.endsWith("/suspend") || path.endsWith("/reactivate")) &&
      options?.method === "POST"
    ) {
      return { data: {} };
    }
    if (path === "/platform/organizations") {
      const query = options?.query;
      const status = queryValue(query, "status");
      const search = String(queryValue(query, "q") ?? "").toLowerCase();
      let rows = [acme, beta, gamma];
      if (status === "SUSPENDED") rows = rows.filter((row) => row.status === "SUSPENDED");
      if (status === "DELETED") rows = rows.filter((row) => row.status === "DELETED");
      if (search) {
        rows = rows.filter((row) =>
          [row.name, row.slug, row.id].some((value) =>
            value.toLowerCase().includes(search),
          ),
        );
      }
      return overrides?.list ? overrides.list(rows, query) : page(rows);
    }
    throw new Error(`Unexpected request: ${options?.method ?? "GET"} ${path}`);
  });
}

describe("SuperadminOrganizationsView", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("renders real overview counts and the organization table", async () => {
    installApi();
    render(<SuperadminOrganizationsView />);

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();

    const metrics = screen.getByText("Total organizations").closest(".grid");
    expect(metrics).not.toBeNull();
    const metricsScope = within(metrics as HTMLElement);
    expect(metricsScope.getByText("Total organizations").parentElement).toHaveTextContent("3");
    expect(metricsScope.getByText("Active").parentElement).toHaveTextContent("1");
    expect(metricsScope.getByText("Suspended").parentElement).toHaveTextContent("1");
    expect(metricsScope.getByText("Deleted").parentElement).toHaveTextContent("1");

    expect(mockedApiRequest).toHaveBeenCalledWith("/platform/overview", expect.anything());
  });

  it("filters by status and searches by name, slug, or stable ID", async () => {
    const user = userEvent.setup();
    installApi();
    render(<SuperadminOrganizationsView />);

    await screen.findByText("Acme");

    await user.selectOptions(screen.getByLabelText("Status"), "SUSPENDED");

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/platform/organizations",
        expect.objectContaining({
          query: expect.objectContaining({ status: "SUSPENDED", page: 1 }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Beta")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Status"), "ALL");
    await user.type(screen.getByLabelText("Search"), "acme");
    await user.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/platform/organizations",
        expect.objectContaining({
          query: expect.objectContaining({ q: "acme", page: 1 }),
        }),
      );
    });
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Beta")).not.toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: "Clear organization search" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/platform/organizations",
        expect.objectContaining({
          query: expect.objectContaining({ q: undefined, page: 1 }),
        }),
      );
    });
  });

  it("paginates results", async () => {
    const user = userEvent.setup();
    installApi({
      list: (rows) =>
        page(rows, { page: 1, total: 45, totalPages: 3 }),
    });
    render(<SuperadminOrganizationsView />);

    await screen.findByText("Acme");
    await user.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/platform/organizations",
        expect.objectContaining({
          query: expect.objectContaining({ page: 2 }),
        }),
      );
    });
  });

  it("suspends and reactivates an organization after confirmation", async () => {
    const user = userEvent.setup();
    installApi();
    render(<SuperadminOrganizationsView />);

    const acmeRow = (await screen.findByText("Acme")).closest("tr");
    expect(acmeRow).not.toBeNull();
    await user.click(within(acmeRow as HTMLElement).getByRole("button", { name: "Suspend" }));

    let dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Suspend Acme?")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Suspend organization" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/platform/organizations/${acmeId}/suspend`,
        { method: "POST" },
      );
    });
    expect(await screen.findByText("Acme suspended.")).toBeInTheDocument();

    const betaRow = screen.getByText("Beta").closest("tr");
    expect(betaRow).not.toBeNull();
    await user.click(
      within(betaRow as HTMLElement).getByRole("button", { name: "Reactivate" }),
    );

    dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Reactivate Beta?")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Reactivate organization" }),
    );

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/platform/organizations/${betaId}/reactivate`,
        { method: "POST" },
      );
    });
    expect(await screen.findByText("Beta reactivated.")).toBeInTheDocument();
  });

  it("marks deleted organizations read-only", async () => {
    installApi();
    render(<SuperadminOrganizationsView />);

    const gammaRow = (await screen.findByText("Gamma")).closest("tr");
    expect(gammaRow).not.toBeNull();
    expect(within(gammaRow as HTMLElement).getByText("Read-only")).toBeInTheDocument();
    expect(
      within(gammaRow as HTMLElement).queryByRole("button", { name: "Suspend" }),
    ).not.toBeInTheDocument();
  });
});
