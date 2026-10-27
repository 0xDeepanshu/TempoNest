import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "@/components/theme-toggle";

type ChangeListener = () => void;

let mediaListeners: Set<ChangeListener>;
let systemPrefersDark: boolean;

function installMatchMedia(matches: boolean) {
  systemPrefersDark = matches;
  mediaListeners = new Set();
  const media = {
    get matches() {
      return systemPrefersDark;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, listener: ChangeListener) => {
      mediaListeners.add(listener);
    },
    removeEventListener: (_type: string, listener: ChangeListener) => {
      mediaListeners.delete(listener);
    },
    addListener: (listener: ChangeListener) => mediaListeners.add(listener),
    removeListener: (listener: ChangeListener) => mediaListeners.delete(listener),
    dispatchEvent: () => true,
  };
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => media,
  });
}

function setSystemPreference(dark: boolean) {
  systemPrefersDark = dark;
  for (const listener of mediaListeners) listener();
}

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  installMatchMedia(false);
});

describe("ThemeToggle", () => {
  it("applies and persists an explicit dark preference", async () => {
    const user = userEvent.setup();
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "System theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Dark theme" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(window.localStorage.getItem("temponest.theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Light theme" }));

    expect(document.documentElement).not.toHaveClass("dark");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(window.localStorage.getItem("temponest.theme")).toBe("light");
  });

  it("follows the operating system in System mode", async () => {
    installMatchMedia(true);
    render(<ThemeToggle />);

    expect(document.documentElement).toHaveClass("dark");

    setSystemPreference(false);
    expect(document.documentElement).not.toHaveClass("dark");

    setSystemPreference(true);
    expect(document.documentElement).toHaveClass("dark");
  });

  it("restores a stored preference on mount", () => {
    window.localStorage.setItem("temponest.theme", "dark");
    render(<ThemeToggle />);

    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("button", { name: "Dark theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("falls back to System for an unknown stored value", () => {
    window.localStorage.setItem("temponest.theme", "sepia");
    render(<ThemeToggle />);

    expect(document.documentElement).not.toHaveClass("dark");
    expect(screen.getByRole("button", { name: "System theme" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
