import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthPanel } from "./auth-panel";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

describe("separate authentication pages", () => {
  beforeEach(() => { vi.restoreAllMocks(); push.mockReset(); });

  it("registers from the dedicated sign-up page and routes to the Patient workspace", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/register")) return { ok: true, json: async () => ({ data: { emailVerificationRequired: true } }) };
      if (url.endsWith("/auth/email/verification/confirm")) return { ok: true, json: async () => ({ data: { user: { role: "Patient" } } }) };
      throw new Error(`Unexpected authentication request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthPanel mode="signup" />);
    expect(screen.getByRole("heading", { name: "Create your patient account." })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Sign in" }).some((link) => link.getAttribute("href") === "/signin")).toBe(true);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "patient@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SecurePass!2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Create patient account" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/v1/auth/register", expect.objectContaining({ method: "POST", credentials: "include" })));
    fireEvent.change(await screen.findByLabelText("Verification code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify email and continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/patient"));
  });

  it("offers Google and Facebook sign-in with provider logos and an email password-reset flow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { accepted: true } }) }));
    render(<AuthPanel mode="signin" />);
    const googleLink = screen.getByRole("link", { name: "Continue with Google" });
    expect(googleLink.getAttribute("href")).toContain("/oauth/google/start");
    expect(googleLink.querySelector("svg.oauth-google-icon[aria-hidden='true']")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Continue with Apple" })).toBeNull();
    const facebookLink = screen.getByRole("link", { name: "Continue with Facebook" });
    expect(facebookLink.getAttribute("href")).toContain("/oauth/facebook/start");
    expect(facebookLink.querySelector("svg.oauth-facebook-icon[aria-hidden='true']")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "patient@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Send reset code" }));
    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeTruthy();
  });

  it("guides an Admin through TOTP enrollment, recovery-code acknowledgement, and Admin routing", async () => {
    const codes = Array.from({ length: 10 }, (_, index) => `CODE-${index}`);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/login")) return { ok: true, json: async () => ({ data: { mfaRequired: true, enrollmentRequired: true } }) };
      if (url.endsWith("/auth/mfa/setup")) return { ok: true, json: async () => ({ data: { secret: "SYNTHETICSETUPKEY", otpauthUri: "otpauth://totp/test" } }) };
      if (url.endsWith("/auth/mfa/verify")) return { ok: true, json: async () => ({ data: { user: { role: "Admin" }, recoveryCodes: codes } }) };
      throw new Error(`Unexpected authentication request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<AuthPanel mode="signin" />);
    expect(screen.getByRole("heading", { name: "Sign in to your account." })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "admin@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "SecureAdmin!2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in securely" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set up authenticator" }));
    expect(await screen.findByText("SYNTHETICSETUPKEY")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Admin authenticator setup QR code" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify and continue" }));
    expect(await screen.findByRole("heading", { name: "Save your recovery codes" })).toBeTruthy();
    expect(screen.getByText("CODE-0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I saved my codes — continue" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin"));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
