"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Cloud, FolderOpen, Loader2, LogOut, Pencil, Search, Trash2,
  User as UserIcon,
} from "lucide-react";
import { regionLabel } from "@/lib/constants";
import { LANDING_ZONE_LABELS, type LandingZoneTier } from "@/lib/pillars/landing-zone";

interface SavedProject {
  id: string;
  customer: string;
  name: string;
  region: string;
  landingZoneTier: LandingZoneTier;
  vmCount: number;
  monthlyCost: number;
  annualCost: number;
  updatedAt: string;
  createdAt: string;
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ProjectsRecap({ user, dbEnabled }: { user: string; dbEnabled: boolean }) {
  const router = useRouter();
  const [projects, setProjects] = useState<SavedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const resp = await fetch("/api/projects", { cache: "no-store" });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as { projects?: SavedProject[] };
      setProjects(data.projects ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (dbEnabled) void refresh();
    else setLoading(false);
  }, [dbEnabled, refresh]);

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function deleteProject(id: string, label: string) {
    if (!confirm(`Delete saved project "${label}"? This can't be undone.`)) return;
    try {
      const resp = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(`Delete failed (HTTP ${resp.status})`);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function renameProject(p: SavedProject) {
    const next = prompt(`Rename project for "${p.customer}"`, p.name)?.trim();
    if (!next || next === p.name) return;
    try {
      const resp = await fetch(`/api/projects/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Rename failed (HTTP ${resp.status})`);
      }
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // Flat list sorted Customer ↑ then Project ↑. Filter applies to both.
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const filtered = q
      ? projects.filter(
          (p) =>
            p.customer.toLowerCase().includes(q) ||
            p.name.toLowerCase().includes(q),
        )
      : projects;
    return [...filtered].sort((a, b) => {
      const c = a.customer.localeCompare(b.customer);
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
  }, [projects, filter]);

  const grandMonthly = rows.reduce((s, r) => s + r.monthlyCost, 0);
  const grandAnnual = rows.reduce((s, r) => s + r.annualCost, 0);
  const uniqueCustomers = new Set(rows.map((r) => r.customer)).size;

  return (
    <div className="container">
      <header className="app-bar">
        <div className="brand">
          <div className="brand-icon" aria-hidden>
            <Cloud size={22} strokeWidth={2.4} />
          </div>
          <div className="brand-text">
            <h1>Azure Cost Assessment</h1>
            <span className="sub">Saved projects recap</span>
          </div>
        </div>
        <div className="user-pill" title={`Signed in as ${user}`}>
          <UserIcon size={14} />
          <span className="who">{user}</span>
        </div>
        <Link href="/" className="ghost icon-only" title="Back to assessment" aria-label="Back to assessment">
          <ArrowLeft size={18} />
        </Link>
        <button className="ghost icon-only" onClick={() => void signOut()} title="Sign out" aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </header>

      <section className="card" style={{ marginTop: "1.5rem" }}>
        <div className="section-head">
          <span className="stage-icon" aria-hidden>
            <FolderOpen size={18} strokeWidth={2.2} />
          </span>
          <span className="stage-title">
            <span className="stage-label">Recap</span>
            <h2>Saved projects</h2>
          </span>
        </div>

        {!dbEnabled && (
          <p className="helper">
            Saved projects are disabled on this deployment — <code>DATABASE_URL</code> is not configured.
          </p>
        )}

        {dbEnabled && (
          <>
            <div className="field" style={{ marginBottom: "1rem", maxWidth: 360 }}>
              <label className="field-label" htmlFor="projects-filter">
                <Search size={14} style={{ display: "inline", marginRight: 6 }} />
                Filter
              </label>
              <input
                id="projects-filter"
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search customer or project name"
              />
            </div>

            {loading && (
              <p className="helper">
                <Loader2 size={14} className="spin" /> Loading saved projects…
              </p>
            )}

            {error && <p className="error">{error}</p>}

            {!loading && !error && projects.length === 0 && (
              <p className="helper">
                No saved projects yet. <Link href="/">Run an assessment</Link> — it auto-saves when Stage 4 completes.
              </p>
            )}

            {!loading && rows.length === 0 && projects.length > 0 && (
              <p className="helper">No projects match the filter.</p>
            )}

            {rows.length > 0 && (
              <div className="projects-table-wrap">
                <table className="projects-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Project</th>
                      <th>Region</th>
                      <th>Landing Zone</th>
                      <th className="num">VMs</th>
                      <th className="num">Monthly (USD)</th>
                      <th className="num">Annual (USD)</th>
                      <th>Last updated</th>
                      <th className="actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => {
                      const lzLabel = LANDING_ZONE_LABELS[p.landingZoneTier] ?? p.landingZoneTier;
                      return (
                        <tr key={p.id}>
                          <td>{p.customer || "—"}</td>
                          <td>{p.name}</td>
                          <td>{regionLabel(p.region)}</td>
                          <td>{lzLabel}</td>
                          <td className="num">{p.vmCount}</td>
                          <td className="num">{fmtMoney(p.monthlyCost)}</td>
                          <td className="num">{fmtMoney(p.annualCost)}</td>
                          <td title={new Date(p.updatedAt).toLocaleString()}>
                            {new Date(p.updatedAt).toLocaleDateString()}
                          </td>
                          <td className="actions">
                            <Link
                              href={`/?load=${encodeURIComponent(p.id)}`}
                              className="primary small"
                            >
                              Open
                            </Link>
                            <button
                              type="button"
                              className="ghost small"
                              onClick={() => void renameProject(p)}
                              aria-label={`Rename ${p.customer} · ${p.name}`}
                              title="Rename"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="danger-ghost small"
                              onClick={() => void deleteProject(p.id, `${p.customer} · ${p.name}`)}
                              aria-label={`Delete ${p.customer} · ${p.name}`}
                              title="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Totals sit below the table now — a portfolio summary after
                the detail rather than four big cards before it. */}
            {rows.length > 0 && (
              <div className="metrics" style={{ marginTop: "1rem" }}>
                <div className="metric">
                  <div className="label">Projects</div>
                  <div className="value">{rows.length}</div>
                </div>
                <div className="metric">
                  <div className="label">Customers</div>
                  <div className="value">{uniqueCustomers}</div>
                </div>
                <div className="metric">
                  <div className="label">Monthly</div>
                  <div className="value"><span className="currency">USD</span>{fmtMoney(grandMonthly)}</div>
                </div>
                <div className="metric">
                  <div className="label">Annual</div>
                  <div className="value"><span className="currency">USD</span>{fmtMoney(grandAnnual)}</div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <footer>
        © {new Date().getFullYear()} Dany Mochtar · Azure Solution Lead @ Noventiq Malaysia
      </footer>
    </div>
  );
}
