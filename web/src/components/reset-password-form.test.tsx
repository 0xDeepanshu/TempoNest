import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

const { params, replace, refresh } = vi.hoisted(() => ({
  params: new URLSearchParams(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
  useSearchParams: () => params,
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
const token = "r".repeat(40);

describe("ResetPasswordForm", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    replace.mockReset();
    refresh.mockReset();
    params.forEach((_value, key) => params.delete(key));
  });

  it("rejects an incomplete reset link", () => {
    render(<ResetPasswordForm />);

    expect(screen.getByText(/incomplete or invalid/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("updates the password and sends the user to sign in", async () => {
    const user = userEvent.setup();
    params.set("token", token);
    mockedApiRequest.mockResolvedValue({
      data: { message: "Your password has been updated. Sign in with your new password." },
    });
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^New password/), "a-brand-new-password");
    await user.type(screen.getByLabelText(/^Confirm new password/), "a-brand-new-password");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith("/auth/reset-password", {
        method: "POST",
        body: { token, password: "a-brand-new-password" },
      });
    });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?reset=1"));
  });

  it("requires matching passwords before submitting", async () => {
    const user = userEvent.setup();
    params.set("token", token);
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^New password/), "a-brand-new-password");
    await user.type(screen.getByLabelText(/^Confirm new password/), "a-different-password");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });

  it("explains when the reset link is no longer valid", async () => {
    const user = userEvent.setup();
    params.set("token", token);
    mockedApiRequest.mockRejectedValue(
      new ApiError({
        status: 400,
        code: "PASSWORD_RESET_INVALID",
        message: "This password reset link is invalid or has expired",
      }),
    );
    render(<ResetPasswordForm />);

    await user.type(screen.getByLabelText(/^New password/), "a-brand-new-password");
    await user.type(screen.getByLabelText(/^Confirm new password/), "a-brand-new-password");
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText("This password reset link is invalid or has expired"),
    ).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });
});
