"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Cloud, Lock, User as UserIcon, UserPlus } from "lucide-react";

export default function RegisterForm({ next }: { next: string }) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
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
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Sign-up failed (HTTP ${resp.status})`);
      }
      router.replace(next);
      router.refresh();
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
          <h1>Create account</h1>
          <p>Pick a username and password — no email needed</p>
        </div>

        {error && (
          <div className="banner error" role="alert">
            <AlertCircle size={16} className="icon" />
            <span>{error}</span>
          </div>
        )}

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
              autoFocus
              minLength={3}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">
              <Lock size={14} /> Password
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
                color:
                  password.length === 0 || passwordOk
                    ? "var(--text-muted)"
                    : "var(--danger)",
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

          <button
            className="primary"
            type="submit"
            disabled={!canSubmit}
            style={{ marginTop: "0.25rem" }}
          >
            {pending ? (
              <>
                <span className="spinner" /> Creating account…
              </>
            ) : (
              <>
                <UserPlus size={16} /> Create account
              </>
            )}
          </button>
        </form>

        <div className="login-foot">
          Already have an account?{" "}
          <Link
            href={`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
          >
            Sign in
          </Link>
        </div>
      </div>
      <p className="copyright-line">
        © {new Date().getFullYear()} Dany Mochtar · Azure Solution Lead @ Noventiq Malaysia
      </p>
    </div>
  );
}
