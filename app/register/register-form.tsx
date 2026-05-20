"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, AtSign, Cloud, Lock, UserPlus } from "lucide-react";

export default function RegisterForm({ next }: { next: string }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const passwordOk = password.length >= 8;
  const matchOk = password === confirm;
  const canSubmit = identifier.length >= 3 && passwordOk && matchOk && !pending;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError("");
    try {
      const resp = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
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
          <p>Sign up to start running assessments</p>
        </div>

        {error && (
          <div className="banner error" role="alert">
            <AlertCircle size={16} className="icon" />
            <span>{error}</span>
          </div>
        )}

        <form className="login-form" onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor="identifier">
              <AtSign size={14} /> Email or username
            </label>
            <input
              id="identifier"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
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
            />
            <div className="helper" style={{ color: password.length === 0 || passwordOk ? "var(--text-muted)" : "var(--danger)" }}>
              At least 8 characters
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
          <Link href={`/login${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}>
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
