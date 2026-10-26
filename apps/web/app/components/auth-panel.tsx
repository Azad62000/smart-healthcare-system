"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type AuthMode = "signin" | "signup";
type EmailFlow = "verification" | "reset-request" | "reset-confirm" | null;
type MfaSetup = { secret: string; otpauthUri: string };

export function AuthPanel({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [enrollmentRequired, setEnrollmentRequired] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<MfaSetup | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [emailAddress, setEmailAddress] = useState("");
  const [emailFlow, setEmailFlow] = useState<EmailFlow>(null);
  const [emailFlowMessage, setEmailFlowMessage] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [oauthNotice, setOauthNotice] = useState("");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("mfa") === "required") {
      setMfaRequired(true);
      setEnrollmentRequired(query.get("enroll") === "1");
    }
    if (query.get("oauth") === "failed") setOauthNotice("Provider sign-in could not be completed. Try again or use email and password.");
    if (query.get("oauth") === "unavailable") {
      const provider = query.get("provider") === "apple" ? "Apple" : "Google";
      setOauthNotice(`${provider} sign-in is not configured yet. Use email and password for now.`);
    }
  }, []);

  function routeToRole(role: string) {
    const destinations: Record<string, string> = { Patient: "/patient", Doctor: "/doctor", Admin: "/admin" };
    router.push(destinations[role] ?? "/");
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    setEmailAddress(email);
    const endpoint = mode === "signup" ? "register" : "login";
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/${endpoint}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.error?.code === "EMAIL_NOT_VERIFIED") {
          setEmailFlow("verification");
          setEmailFlowMessage("Enter the code sent to your email address.");
          return;
        }
        if (mode === "signup" && body.error?.code === "ACCOUNT_EXISTS") {
          setEmailFlow("verification");
          setEmailFlowMessage("An account already uses this address. Verify it or request a new code.");
          return;
        }
        throw new Error(body.error?.message ?? (mode === "signup" ? "Unable to create account." : "Unable to sign in."));
      }
      if (body.data.emailVerificationRequired) {
        setEmailFlow("verification");
        setEmailFlowMessage("Enter the verification code sent to your email address.");
        return;
      }
      if (body.data.mfaRequired) {
        setMfaRequired(true);
        setEnrollmentRequired(Boolean(body.data.enrollmentRequired));
      } else routeToRole(body.data.user.role as string);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to complete your request.");
    } finally { setBusy(false); }
  }

  async function submitEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/email/verification/confirm`, {
        method: "POST", credentials: "include", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailAddress, code: emailCode })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not verify your email.");
      routeToRole(body.data.user.role as string);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not verify your email."); }
    finally { setBusy(false); }
  }

  async function requestEmailCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setEmailFlowMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/password/reset/request`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailAddress })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not request a reset code.");
      setEmailFlow("reset-confirm");
      setEmailFlowMessage("If that address has a verified account, a reset code will arrive by email.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not request a reset code."); }
    finally { setBusy(false); }
  }

  async function resetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setEmailFlowMessage("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/password/reset/confirm`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailAddress, code: emailCode, password: form.get("password") })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not reset your password.");
      setEmailFlow(null);
      setEmailCode("");
      setEmailFlowMessage("Password updated. Sign in with your new password.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reset your password."); }
    finally { setBusy(false); }
  }

  async function resendVerificationCode() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/email/verification/request`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: emailAddress })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not request another code.");
      setEmailFlowMessage("If the address needs verification, a new code has been sent.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not request another code."); }
    finally { setBusy(false); }
  }

  async function startMfaSetup() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/mfa/setup`, { method: "POST", credentials: "include" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not start MFA setup.");
      setMfaSetup(body.data as MfaSetup);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start MFA setup."); }
    finally { setBusy(false); }
  }

  async function verifyMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/v1/auth/mfa/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: verificationCode })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Could not verify the code.");
      if (body.data.recoveryCodes) setRecoveryCodes(body.data.recoveryCodes as string[]);
      else routeToRole(body.data.user.role as string);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not verify the code."); }
    finally { setBusy(false); }
  }

  function cancelMfa() {
    setMfaRequired(false); setEnrollmentRequired(false); setMfaSetup(null); setVerificationCode(""); setRecoveryCodes(null); setError("");
  }

  return <main className="welcome-page">
    <header className="welcome-header">
      <a className="brand" href="/" aria-label="Smart Healthcare home"><span className="brand-mark" aria-hidden="true">＋</span> Smart Healthcare</a>
      <nav aria-label="Account navigation">
        <a href={mode === "signin" ? "/signup" : "/signin"}>{mode === "signin" ? "Create account" : "Sign in"}</a>
      </nav>
    </header>
    <section className="account-section auth-page" aria-labelledby="account-title">
      <div className="account-copy">
        <p className="eyebrow">{mode === "signup" ? "GET STARTED" : "WELCOME BACK"}</p>
        <h1>{mode === "signup" ? "Create your patient account." : "Sign in to your account."}</h1>
        <p>{mode === "signup" ? "Create a secure account to manage your care and appointments." : "Access your healthcare workspace securely."}</p>
      </div>
      <div className="auth-card">
        {recoveryCodes ? <>
          <h2 id="account-title">Save your recovery codes</h2>
          <p className="auth-intro">Each code works once if you cannot access your authenticator. They are shown only now; store them somewhere private.</p>
          <ul className="mfa-recovery-codes">{recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}</ul>
          <button className="primary-button auth-submit" type="button" onClick={() => routeToRole("Admin")}>I saved my codes — continue</button>
        </> : mfaRequired ? <>
          <h2 id="account-title">{enrollmentRequired ? "Secure your Admin account" : "Verify it’s you"}</h2>
          <p className="auth-intro">{enrollmentRequired ? "Admin accounts must enroll an authenticator before accessing the dashboard." : "Enter the 6-digit code from your authenticator app, or use a recovery code."}</p>
          {enrollmentRequired && !mfaSetup ? <button className="primary-button auth-submit" type="button" disabled={busy} onClick={() => void startMfaSetup()}>{busy ? "Preparing setup…" : "Set up authenticator"}</button> : <>
            {mfaSetup && <section className="mfa-setup-instructions"><p>Add this account manually in an authenticator app using this setup key:</p><p><code>{mfaSetup.secret}</code></p><details><summary>Show setup URI</summary><code>{mfaSetup.otpauthUri}</code></details></section>}
            <form onSubmit={verifyMfa}>
              <label>{enrollmentRequired ? "Authenticator code" : "Authenticator or recovery code"}<input value={verificationCode} onChange={(event) => setVerificationCode(event.target.value)} autoComplete="one-time-code" inputMode="text" maxLength={32} required /></label>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? "Verifying…" : "Verify and continue"}</button>
            </form>
          </>}
          {error && enrollmentRequired && !mfaSetup && <p className="auth-error" role="alert">{error}</p>}
          <p className="auth-switch"><button type="button" onClick={cancelMfa}>Cancel and return to sign in</button></p>
        </> : emailFlow === "verification" ? <>
          <h2 id="account-title">Verify your email</h2>
          <p className="auth-intro">{emailFlowMessage || `Enter the code sent to ${emailAddress}.`}</p>
          <form onSubmit={submitEmailCode}>
            <label>Verification code<input value={emailCode} onChange={(event) => setEmailCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? "Verifying…" : "Verify email and continue"}</button>
          </form>
          <p className="auth-switch"><button type="button" disabled={busy} onClick={() => void resendVerificationCode()}>Send a new code</button></p>
        </> : emailFlow === "reset-request" ? <>
          <h2 id="account-title">Reset your password</h2>
          <p className="auth-intro">We’ll email a code only if this address belongs to a verified account.</p>
          <form onSubmit={requestEmailCode}>
            <label>Email address<input type="email" value={emailAddress} onChange={(event) => setEmailAddress(event.target.value)} autoComplete="email" required /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? "Requesting…" : "Send reset code"}</button>
          </form>
          <p className="auth-switch"><button type="button" onClick={() => { setEmailFlow(null); setError(""); }}>Return to sign in</button></p>
        </> : emailFlow === "reset-confirm" ? <>
          <h2 id="account-title">Choose a new password</h2>
          <p className="auth-intro">{emailFlowMessage}</p>
          <form onSubmit={resetPassword}>
            <label>Email address<input type="email" value={emailAddress} onChange={(event) => setEmailAddress(event.target.value)} autoComplete="email" required /></label>
            <label>Email code<input value={emailCode} onChange={(event) => setEmailCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label>
            <label>New password<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? "Updating…" : "Reset password"}</button>
          </form>
          <p className="auth-switch"><button type="button" onClick={() => { setEmailFlow("reset-request"); setError(""); }}>Request another code</button></p>
        </> : <>
          <h2 id="account-title">{mode === "signup" ? "Create a patient account" : "Welcome back"}</h2>
          <p className="auth-intro">{mode === "signup" ? "Your account is the first step to managing your care." : "Sign in to continue to your healthcare workspace."}</p>
          {oauthNotice && <p className="auth-error" role="alert">{oauthNotice}</p>}
          {emailFlowMessage && <p className="auth-success" role="status">{emailFlowMessage}</p>}
          {mode === "signin" && <div className="oauth-options" aria-label="Other sign-in options">
            <a className="secondary-button auth-submit" href={`${apiUrl}/api/v1/auth/oauth/google/start`}>Continue with Google</a>
            <a className="secondary-button auth-submit" href={`${apiUrl}/api/v1/auth/oauth/apple/start`}>Continue with Apple</a>
          </div>}
          <form onSubmit={authenticate}>
            <label>Email address<input name="email" type="email" autoComplete="username" placeholder="you@example.com" required /></label>
            <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} placeholder={mode === "signup" ? "At least 12 characters" : "Enter your password"} minLength={12} maxLength={128} required /></label>
            {mode === "signup" && <p className="patient-only-note">Patient registration is open. Doctor and admin accounts are managed separately.</p>}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button auth-submit" disabled={busy} type="submit">{busy ? (mode === "signup" ? "Creating account…" : "Signing in…") : (mode === "signup" ? "Create patient account" : "Sign in securely")} <span aria-hidden="true">→</span></button>
          </form>
          {mode === "signin" && <p className="auth-switch"><button type="button" onClick={() => { setEmailFlow("reset-request"); setEmailAddress(""); setEmailFlowMessage(""); setError(""); }}>Forgot password?</button></p>}
          <p className="auth-switch">{mode === "signup" ? "Already have an account?" : "New to Smart Healthcare?"} <a href={mode === "signup" ? "/signin" : "/signup"}>{mode === "signup" ? "Sign in" : "Create an account"}</a></p>
        </>}
      </div>
    </section>
    <footer className="welcome-footer"><a className="brand" href="/"> <span className="brand-mark" aria-hidden="true">＋</span> Smart Healthcare</a><span>Thoughtful care, connected.</span><span>© 2026 Smart Healthcare</span></footer>
  </main>;
}
