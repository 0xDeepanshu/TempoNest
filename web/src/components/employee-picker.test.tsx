import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EmployeePicker } from "@/components/employee-picker";
import { apiRequest } from "@/lib/api-client";
import type { MemberListItem, Paginated } from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const member: MemberListItem = {
  id: "membership-1",
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

const directory: Paginated<MemberListItem> = {
  data: [member],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

beforeEach(() => {
  mockedApiRequest.mockResolvedValue(directory);
});

async function renderPicker(value = "employee-1") {
  const onChange = vi.fn();
  const view = render(
    <EmployeePicker organizationId="org-1" value={value} onChange={onChange} />,
  );
  const combobox = screen.getByRole("combobox");
  await waitFor(() => expect(combobox).toHaveValue("Ada Lovelace"));
  return { ...view, combobox, onChange };
}

describe("EmployeePicker clear button", () => {
  it("centers the clear button and reserves input padding", async () => {
    await renderPicker();

    const clear = screen.getByRole("button", { name: "Clear employee" });
    expect(clear.className).toContain("-translate-y-1/2");
    expect(clear.className).toContain("top-1/2");
    expect(screen.getByRole("combobox").className).toContain("pr-10");
  });

  it("clears with the mouse and returns focus to the search field", async () => {
    const user = userEvent.setup();
    const { combobox, onChange } = await renderPicker();

    await user.click(screen.getByRole("button", { name: "Clear employee" }));

    expect(onChange).toHaveBeenCalledWith("");
    expect(combobox).toHaveFocus();
  });

  it("clears from the keyboard", async () => {
    const user = userEvent.setup();
    const { combobox, onChange } = await renderPicker();

    await user.click(combobox);
    await user.tab();
    expect(screen.getByRole("button", { name: "Clear employee" })).toHaveFocus();

    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith("");
    expect(combobox).toHaveFocus();
  });
});
