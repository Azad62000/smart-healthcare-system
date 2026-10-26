import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("public welcome page", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("links sign-in and patient registration to their dedicated pages", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "Your health, in good hands." })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Everything you need to stay connected" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /^Sign in$/ }).some((link) => link.getAttribute("href") === "/signin")).toBe(true);
    expect(screen.getAllByRole("link", { name: "Create a patient account" }).some((link) => link.getAttribute("href") === "/signup")).toBe(true);
  });
});
