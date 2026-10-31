import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AnchorHTMLAttributes } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";

const { params } = vi.hoisted(() => ({ params: new URLSearchParams() }));

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

vi.mock("next/navigation", () => ({
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

describe("ForgotPasswordForm", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
    params.forEach((_value, key) => params.delete(key));
  });

  it("prefills the invited email from the query string", () => {
    params.set("email", "ada@example.com");
    render(<ForgotPasswordForm />);

    expect(screen.getByLabelText(/^Email/)).toHaveValue("ada@example.com");
  });

  it("requests a reset link and shows a generic confirmation", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValue({
      data: { message: "If an account exists for that email address, a reset link is on its way." },
    });
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/^Email/), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith("/auth/forgot-password", {
        method: "POST",
        body: { email: "ada@example.com" },
      });
    });
    expect(await screen.findByText(/If an account exists for/)).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("requires an email address", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);

    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText("Enter the email address you use for TempoNest."),
    ).toBeInTheDocument();
    expect(mockedApiRequest).not.toHaveBeenCalled();
  });

  it("surfaces throttling errors", async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockRejectedValue(
      new ApiError({
        status: 429,
        code: "RATE_LIMITED",
        message: "Too many attempts. Please try again later.",
      }),
    );
    render(<ForgotPasswordForm />);

    await user.type(screen.getByLabelText(/^Email/), "ada@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText("Too many attempts. Please try again later."),
    ).toBeInTheDocument();
  });
});
