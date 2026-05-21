"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, BadgeCheck, Cloud, KeyRound, Lock, User as UserIcon } from "lucide-react";

export default function ForgotForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const usernameOk = username.trim().length >= 3;
  const passwordOk = password.length >= 6;
  const matchOk = password === confirm;
  const canSubmit = usernameOk && passwordOk && matchOk && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError("");
    try {
      const resp = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), newPassword: password }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Reset failed (HTTP ${resp.status})`);
      }
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-header">
          <div className="brand-icon" aria-hidden>
            <Cloud size={28} strokeWidth={2.4} />
          </div>
          <h1>Reset password</h1>
          <p>Set a new password for your account</p>
        </div>

        {error && (
          <div className="banner error" role="alert">
            <AlertCircle size={16} className="icon" />
            <span>{error}</span>
          </div>
        )}

        {done ? (
          <>
            <div className="banner success" role="status">
              <BadgeCheck size={16} className="icon" />
              <span>
                If the account exists, the password has been reset. You can now sign in
                with the new password.
              </span>
            </div>
            <Link href="/login" className="button primary" style={{ width: "100%", marginTop: "0.75rem" }}>
              <KeyRound size={16} /> Go to sign in
            </Link>
          </>
        ) : (
          <form className="login-form" onSubmit={submit}>
            <div className="field">
              <label className="field-label" htmlFor="username">
                <UserIcon size={14} /> Username
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. dany"
                required
                minLength={3}
                autoFocus
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="password">
                <Lock size={14} /> New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />
              <div
                className="helper"
                style={{
                  color: password.length === 0 || passwordOk ? "var(--text-muted)" : "var(--danger)",
                }}
              >
                At least 6 characters
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="confirm">
                <Lock size={14} /> Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {confirm.length > 0 && !matchOk && (
                <div className="helper" style={{ color: "var(--danger)" }}>
                  Passwords don&apos;t match
                </div>
              )}
            </div>

            <button className="primary" type="submit" disabled={!canSubmit} style={{ marginTop: "0.25rem" }}>
              {pending ? (
                <>
                  <span className="spinner" /> Resetting…
                </>
              ) : (
                <>
                  <KeyRound size={16} /> Reset password
                </>
              )}
            </button>
          </form>
        )}

        <div className="login-foot">
          <Link href="/login">Back to sign in</Link>
        </div>
      </div>
    </div>
  );
}
