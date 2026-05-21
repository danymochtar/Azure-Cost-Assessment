"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Lock, AlertCircle, Cloud, LogIn, UserPlus } from "lucide-react";

export default function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!password) return;
    setPending(true);
    setError("");
    try {
      const resp = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user, password }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Sign-in failed (HTTP ${resp.status})`);
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
          <h1>Azure Cost Assessment</h1>
          <p>Sign in to continue</p>
        </div>

        {error && (
          <div className="banner error" role="alert">
            <AlertCircle size={16} className="icon" />
            <span>{error}</span>
          </div>
        )}

        <form className="login-form" onSubmit={submit}>
          <div className="field">
            <label className="field-label" htmlFor="user">
              Username
            </label>
            <input
              id="user"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="Your username"
              required
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="password">
              <Lock size={14} /> Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              autoFocus
            />
          </div>

          <button
            className="primary"
            type="submit"
            disabled={pending || !password}
            style={{ marginTop: "0.25rem" }}
          >
            {pending ? (
              <>
                <span className="spinner" /> Signing in…
              </>
            ) : (
              <>
                <LogIn size={16} /> Sign in
              </>
            )}
          </button>

          <Link
            href={`/register${next && next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="button"
            style={{ width: "100%" }}
          >
            <UserPlus size={16} /> Create account
          </Link>
        </form>

        <div className="login-foot">
          <Link href="/forgot">Forgot password?</Link>
          {" · "}
          Session signed with <code>BETTER_AUTH_SECRET</code> · 30-day cookie
        </div>
      </div>
      <p className="copyright-line">
        © {new Date().getFullYear()} Dany Mochtar · Azure Solution Lead @ Noventiq Malaysia
      </p>
    </div>
  );
}
