"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertCircle, AlertTriangle, BadgeCheck, Calculator, Cloud, Download,
  FileText, Files, Loader2, LogOut, Receipt, RefreshCcw, Search, Server,
  Settings2, Sparkles, UploadCloud, User as UserIcon, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Tooltip } from "@/components/Tooltip";
import { AZURE_REGIONS, DEFAULT_REGION, regionLabel } from "@/lib/constants";
import type { AssessmentProfile, BomLine, ComputeMode, InventoryItem, PricingMode } from "@/lib/models";

const MAX_TOTAL_UPLOAD_MB = 4;

type UploadedFile = { file: File };
interface PerFile { filename: string; profile: AssessmentProfile | null; error?: string }

const PILLAR_LABELS: Record<string, string> = {
  infra_lift_shift: "Infra Lift-and-Shift",
  infra_modernization: "Infra Modernization",
  data_platform: "Data Platform",
  ai_application: "AI Application",
  azure_security: "Azure Security",
  hybrid_multicloud: "Hybrid Multicloud",
  m365_and_others: "M365 & Others",
  mixed: "Mixed workload",
  unknown: "Unknown",
};

const PORTED_PILLARS = new Set(["infra_lift_shift"]);

function fmtMoney(n: number, opts: Intl.NumberFormatOptions = {}): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2, ...opts });
}

function sumMonthly(rows: BomLine[]): number {
  return rows.reduce((s, l) => s + l.monthlyCost, 0);
}

function loadingLabel(stage: "idle" | "classifying" | "extracting" | "pricing"): string {
  if (stage === "classifying" || stage === "extracting") return "Analyzing workload…";
  if (stage === "pricing") return "Pricing meters…";
  return "";
}

export default function AssessmentApp({ user }: { user: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [appName, setAppName] = useState("");
  const [region, setRegion] = useState<string>(DEFAULT_REGION);
  const [pricingMode, setPricingMode] = useState<PricingMode>("payg");
  const [computeMode, setComputeMode] = useState<ComputeMode>("normal");
  const [useAhbWindows, setUseAhbWindows] = useState(false);
  const [nonProdPayg, setNonProdPayg] = useState(true);
  const [diskTier, setDiskTier] = useState<"Premium SSD" | "Standard SSD" | "Standard HDD">("Standard SSD");
  const [autoDiskTier, setAutoDiskTier] = useState(true);
  const [headroom, setHeadroom] = useState(1.0);

  const [profile, setProfile] = useState<AssessmentProfile | null>(null);
  const [perFile, setPerFile] = useState<PerFile[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [lines, setLines] = useState<BomLine[]>([]);
  const [stage, setStage] = useState<"idle" | "classifying" | "extracting" | "pricing">("idle");
  const [error, setError] = useState<string>("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const totalBytes = useMemo(() => {
    let n = 0;
    for (const f of files) n += f.file.size;
    n += new TextEncoder().encode(pastedText).length;
    return n;
  }, [files, pastedText]);
  const tooLarge = totalBytes > MAX_TOTAL_UPLOAD_MB * 1024 * 1024;

  const onSelectFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const next: UploadedFile[] = Array.from(fileList).map((file) => ({ file }));
    setFiles((curr) => [...curr, ...next]);
  }, []);
  const removeFile = (i: number) => setFiles((curr) => curr.filter((_, idx) => idx !== i));

  function buildFormData(): FormData | null {
    const fd = new FormData();
    let count = 0;
    files.forEach((f, i) => {
      fd.append(`file_${i}`, f.file, f.file.name);
      count += 1;
    });
    if (pastedText.trim()) {
      const blob = new Blob([pastedText], { type: "text/plain" });
      fd.append(`pasted`, blob, `pasted-content-${Date.now()}.txt`);
      count += 1;
    }
    return count > 0 ? fd : null;
  }

  function resetAll() {
    setFiles([]);
    setPastedText("");
    setProfile(null);
    setPerFile([]);
    setItems([]);
    setLines([]);
    setError("");
    setWarnings([]);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  async function runAnalyze() {
    const fd = buildFormData();
    if (!fd) {
      setError("Add at least one file or paste content before running.");
      return;
    }
    if (tooLarge) {
      setError(`Combined upload size ${(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds the ${MAX_TOTAL_UPLOAD_MB} MB limit.`);
      return;
    }
    setError("");
    setWarnings([]);
    setProfile(null);
    setPerFile([]);
    setItems([]);
    setLines([]);
    setStage("classifying");
    try {
      const resp = await fetch("/api/classify", { method: "POST", body: fd });
      if (!resp.ok) throw new Error(`Analyze HTTP ${resp.status}: ${await resp.text()}`);
      const data = (await resp.json()) as { profile: AssessmentProfile; perFile: PerFile[] };
      setProfile(data.profile);
      setPerFile(data.perFile ?? []);

      if (data.profile.workloadType === "infra_lift_shift" || data.profile.needsVmExtraction) {
        const fd2 = buildFormData();
        if (!fd2) return;
        setStage("extracting");
        const eResp = await fetch("/api/extract", { method: "POST", body: fd2 });
        if (!eResp.ok) throw new Error(`Extract HTTP ${eResp.status}: ${await eResp.text()}`);
        const eData = (await eResp.json()) as { items: InventoryItem[]; warnings: string[] };
        setItems(eData.items);
        if (eData.warnings?.length) setWarnings(eData.warnings);
      } else if (!PORTED_PILLARS.has(data.profile.workloadType)) {
        setWarnings([
          `Detected "${PILLAR_LABELS[data.profile.workloadType] ?? data.profile.workloadType}". This pillar isn't priced yet in this build — see docs/PORTING-ROADMAP.md.`,
        ]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage("idle");
    }
  }

  async function runPrice() {
    if (items.length === 0) {
      setError("Run Analyze workload first.");
      return;
    }
    setError("");
    setStage("pricing");
    try {
      const resp = await fetch("/api/price", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          options: {
            region, pricingMode, computeMode, useAhbWindows, nonProdPayg,
            defaultDiskTier: diskTier, autoDiskTier, appName, headroom,
          },
        }),
      });
      if (!resp.ok) throw new Error(`Estimate HTTP ${resp.status}: ${await resp.text()}`);
      const data = (await resp.json()) as { lines: BomLine[]; warnings?: string[] };
      setLines(data.lines);
      if (data.warnings?.length) setWarnings((w) => [...w, ...data.warnings!]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStage("idle");
    }
  }

  async function downloadExcel() {
    const resp = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: "xlsx", lines, region, appName }),
    });
    if (!resp.ok) {
      setError(`Export HTTP ${resp.status}: ${await resp.text()}`);
      return;
    }
    const data = (await resp.json()) as { data: string; mime: string; filename: string };
    const bin = atob(data.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    triggerDownload(new Blob([bytes], { type: data.mime }), data.filename);
  }

  const totalMonthly = useMemo(() => sumMonthly(lines), [lines]);

  // Group results by service category, highest subtotal first.
  const grouped = useMemo(() => {
    const m = new Map<string, BomLine[]>();
    for (const l of lines) {
      const k = l.category || "Other";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(l);
    }
    return Array.from(m.entries()).sort(
      (a, b) => sumMonthly(b[1]) - sumMonthly(a[1]),
    );
  }, [lines]);

  const detectedLabel = profile ? PILLAR_LABELS[profile.workloadType] ?? profile.workloadType : "";

  return (
    <div className="container">
      <header className="app-bar">
        <div className="brand">
          <div className="brand-icon" aria-hidden>
            <Cloud size={22} strokeWidth={2.4} />
          </div>
          <div className="brand-text">
            <h1>Azure Cost Assessment</h1>
            <span className="sub">Live Azure retail pricing</span>
          </div>
        </div>
        <div className="user-pill" title={`Signed in as ${user}`}>
          <UserIcon size={14} />
          <span className="who">{user}</span>
        </div>
        <button className="ghost icon-only" onClick={resetAll} title="Start over" aria-label="Start over">
          <RefreshCcw size={18} />
        </button>
        <button className="ghost icon-only" onClick={() => void signOut()} title="Sign out" aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </header>

      <p className="hero-pitch">
        Upload your workload. Pick your Azure design. Get a live cost estimate.
      </p>

      {error && (
        <div className="banner error" role="alert">
          <AlertCircle size={16} className="icon" />
          <span>{error}</span>
        </div>
      )}
      {warnings.map((w, i) => (
        <div className="banner warning" key={i}>
          <AlertTriangle size={16} className="icon" />
          <span>{w}</span>
        </div>
      ))}

      {/* ============================================================
         Phase 1 — Assess
         ============================================================ */}
      <section className="card">
        <div className="section-head">
          <span className="phase-icon" aria-hidden>
            <Search size={18} strokeWidth={2.2} />
          </span>
          <span className="phase-title">
            <span className="phase-label">Phase 1</span>
            <h2>Assess workload</h2>
          </span>
        </div>

        <div
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).classList.add("dragover");
          }}
          onDragLeave={(e) => (e.currentTarget as HTMLDivElement).classList.remove("dragover")}
          onDrop={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).classList.remove("dragover");
            onSelectFiles(e.dataTransfer.files);
          }}
        >
          <UploadCloud className="icon-lg" strokeWidth={1.6} />
          <strong>Tap or drop files</strong>
          <span className="hint">Excel · CSV · PDF · Word · image · text · ≤ {MAX_TOTAL_UPLOAD_MB} MB total</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept=".xlsx,.xls,.csv,.pdf,.docx,.png,.jpg,.jpeg,.gif,.webp,.txt,.md,.json,.yml,.yaml,.log"
          onChange={(e) => onSelectFiles(e.target.files)}
        />

        {files.length > 0 && (
          <div className="file-list">
            {files.map((f, i) => (
              <div className="file-row" key={`${f.file.name}-${i}`}>
                <FileText size={16} className="icon" />
                <span className="name">{f.file.name}</span>
                <span className="size">{(f.file.size / 1024).toFixed(1)} KB</span>
                <button className="danger-ghost" onClick={() => removeFile(i)} aria-label="Remove file">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="field" style={{ marginTop: "1rem" }}>
          <label className="field-label" htmlFor="pasted">
            <Files size={14} /> Or paste content
            <Tooltip
              label="Paste content"
              content="Drop in an email thread, meeting note, or freeform spec instead of a file. The classifier reads it the same way."
            />
          </label>
          <textarea
            id="pasted"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={4}
            placeholder="e.g. 50 Linux VMs running PostgreSQL — 8 vCPU / 32 GB each…"
          />
        </div>

        {totalBytes > 0 && (
          <div className={`upload-total${tooLarge ? " over" : ""}`}>
            <span>
              Total upload: <strong>{(totalBytes / 1024 / 1024).toFixed(2)} MB</strong>
              {tooLarge && ` — over ${MAX_TOTAL_UPLOAD_MB} MB limit`}
            </span>
          </div>
        )}

        {/* Phase 1 CTA — only appears here. Advances the flow to Phase 2. */}
        <div style={{ marginTop: "1.25rem" }}>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={stage !== "idle" || tooLarge || (files.length === 0 && !pastedText.trim())}
            onClick={() => void runAnalyze()}
          >
            {stage === "classifying" || stage === "extracting" ? (
              <><Loader2 size={16} className="spin" /> {loadingLabel(stage)}</>
            ) : (
              <><Sparkles size={16} /> Analyze workload</>
            )}
          </button>
        </div>

        {/* Detected workload + extracted resources fold into Phase 1 */}
        {profile && (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 style={{ marginBottom: "0.5rem" }}>Detected workload</h3>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
              <span className="badge">
                <BadgeCheck size={12} /> {detectedLabel}
              </span>
              <span className="badge muted">Confidence {(profile.confidence * 100).toFixed(0)}%</span>
              <span className="badge muted">Complexity {profile.complexity}</span>
              {!PORTED_PILLARS.has(profile.workloadType) && profile.workloadType !== "unknown" && (
                <span className="badge danger">Pillar not yet priced</span>
              )}
            </div>
            {profile.summary && (
              <p className="helper" style={{ marginTop: "0.5rem" }}>{profile.summary}</p>
            )}
            {perFile.length > 1 && (
              <details>
                <summary>Per-file classification ({perFile.length} files)</summary>
                <ul>
                  {perFile.map((p, i) => (
                    <li key={i}>
                      {p.error ? (
                        <><AlertCircle size={12} style={{ verticalAlign: "middle", color: "var(--danger)" }} /> <code>{p.filename}</code> — {p.error}</>
                      ) : p.profile ? (
                        <><BadgeCheck size={12} style={{ verticalAlign: "middle", color: "var(--success)" }} /> <code>{p.filename}</code> — {PILLAR_LABELS[p.profile.workloadType] ?? p.profile.workloadType} · {(p.profile.confidence * 100).toFixed(0)}%</>
                      ) : (
                        <><AlertTriangle size={12} style={{ verticalAlign: "middle" }} /> <code>{p.filename}</code> — no profile</>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {profile.signals.length > 0 && (
              <details>
                <summary>Why this classification? ({profile.signals.length} signals)</summary>
                <ul>{profile.signals.map((s, i) => <li key={i}>{s}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        {items.length > 0 && (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Extracted resources
              <span className="badge muted">
                <Server size={12} /> {items.length} virtual machines
              </span>
            </h3>
            <div className="table-wrap scroll-y">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="num">vCPU</th>
                    <th className="num">Memory (GB)</th>
                    <th className="num">Storage (GB)</th>
                    <th>OS</th>
                    <th>Env</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.name}>
                      <td><code>{it.name}</code></td>
                      <td className="num">{it.vcpu}</td>
                      <td className="num">{it.memoryGb.toFixed(1)}</td>
                      <td className="num">{it.storageGb.toFixed(0)}</td>
                      <td>{it.os}</td>
                      <td>{it.environment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ============================================================
         Phase 2 — Design
         Gated: only appears once Phase 1 produced extracted resources.
         ============================================================ */}
      {items.length > 0 && (
      <section className="card">
        <div className="section-head">
          <span className="phase-icon" aria-hidden>
            <Settings2 size={18} strokeWidth={2.2} />
          </span>
          <span className="phase-title">
            <span className="phase-label">Phase 2</span>
            <h2>Design parameters</h2>
          </span>
        </div>

        <div className="row cols-4">
          <div className="field">
            <label className="field-label" htmlFor="appName">
              Application name
              <Tooltip
                label="Application name"
                content="Tagged into the Custom name column of every line in the Excel export."
              />
            </label>
            <input id="appName" type="text" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="e.g. ERPSuite" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="region">
              Primary region
              <Tooltip
                label="Primary region"
                content="Where the workload runs. Affects retail meter selection — APAC regions like Malaysia West auto-fall-back to Southeast Asia when meters aren't published."
              />
            </label>
            <select id="region" value={region} onChange={(e) => setRegion(e.target.value)}>
              {AZURE_REGIONS.map((r) => (
                <option key={r} value={r}>{regionLabel(r)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="compute">
              Compute mode
              <Tooltip
                label="Compute mode"
                content="Saving = Burstable / Basic (~30-60% cheaper, non-prod only). Normal = production-grade D-series. High Performance = E/F-series for memory- or compute-bound workloads."
              />
            </label>
            <select id="compute" value={computeMode} onChange={(e) => setComputeMode(e.target.value as ComputeMode)}>
              <option value="saving">Saving — Burstable / Basic</option>
              <option value="normal">Normal — D-series (default)</option>
              <option value="high_perf">High Performance — E / F-series</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="billing">
              Billing term
              <Tooltip
                label="Billing term"
                content="PAYG = full retail. SP / RI 1-3 years commit you to discounted rates (~30-60% off). Non-prod stays on PAYG when the checkbox below is on."
              />
            </label>
            <select id="billing" value={pricingMode} onChange={(e) => setPricingMode(e.target.value as PricingMode)}>
              <option value="payg">Pay-as-you-go</option>
              <option value="sp_1y">Savings Plan (1 year)</option>
              <option value="sp_3y">Savings Plan (3 years)</option>
              <option value="ri_1y">Reserved Instance (1 year)</option>
              <option value="ri_3y">Reserved Instance (3 years)</option>
            </select>
          </div>
        </div>

        <div className="row cols-3" style={{ marginTop: "1rem" }}>
          <div className="field">
            <label className="field-label" htmlFor="diskTier">
              Default disk tier
              <Tooltip
                label="Default disk tier"
                content="Premium SSD for OLTP / DB. Standard SSD for general workloads (recommended baseline). Standard HDD for backup / archive / cold storage."
              />
            </label>
            <select id="diskTier" value={diskTier} onChange={(e) => setDiskTier(e.target.value as typeof diskTier)}>
              <option value="Premium SSD">Premium SSD</option>
              <option value="Standard SSD">Standard SSD (recommended)</option>
              <option value="Standard HDD">Standard HDD</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="headroom">
              Safety margin
              <Tooltip
                label="Safety margin"
                content="Multiplier on vCPU + memory. 1.0 = exact 1:1 sizing (cost-optimised). 1.2 = +20% headroom for bursty workloads. 1.5 = +50% for latency-sensitive prod."
              />
            </label>
            <input id="headroom" type="number" min={1.0} max={2.0} step={0.05} value={headroom} onChange={(e) => setHeadroom(Number(e.target.value))} />
          </div>
          <div className="col col-stack">
            <label className="checkbox-row">
              <input type="checkbox" checked={autoDiskTier} onChange={(e) => setAutoDiskTier(e.target.checked)} />
              <span>Auto-route disk tier per VM</span>
              <Tooltip
                label="Auto-route disk tier"
                content="VMs named like *sql* / *db* route to Premium SSD; *backup* / *archive* / *log* route to Standard HDD; everything else uses the default tier above."
              />
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={useAhbWindows} onChange={(e) => setUseAhbWindows(e.target.checked)} />
              <span>Windows Server AHB</span>
              <Tooltip
                label="Windows Server AHB"
                content="Use your existing Windows Server license. Swaps Windows-VM pricing for Linux-VM pricing of the same SKU (~30-40% off Windows)."
              />
            </label>
            <label className={`checkbox-row${pricingMode === "payg" ? " disabled" : ""}`}>
              <input type="checkbox" checked={nonProdPayg} onChange={(e) => setNonProdPayg(e.target.checked)} disabled={pricingMode === "payg"} />
              <span>Keep non-prod VMs on PAYG</span>
              <Tooltip
                label="Non-prod on PAYG"
                content="Detects UAT / dev / test / staging / sandbox by name and keeps those VMs on Pay-as-you-go even when the global billing term is RI or SP."
              />
            </label>
          </div>
        </div>

        {/* Phase 2 CTA — advances the flow to Phase 3. */}
        <div style={{ marginTop: "1.25rem" }}>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={stage !== "idle"}
            onClick={() => void runPrice()}
          >
            {stage === "pricing" ? (
              <><Loader2 size={16} className="spin" /> {loadingLabel(stage)}</>
            ) : (
              <><Calculator size={16} /> Generate estimate</>
            )}
          </button>
        </div>
      </section>
      )}

      {/* ============================================================
         Phase 3 — Estimate
         ============================================================ */}
      {lines.length > 0 && (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <div className="section-head">
            <span className="phase-icon" aria-hidden>
              <Receipt size={18} strokeWidth={2.2} />
            </span>
            <span className="phase-title">
              <span className="phase-label">Phase 3</span>
              <h2>Cost estimate</h2>
            </span>
          </div>

          <div className="metrics">
            <div className="metric">
              <div className="label">Line items</div>
              <div className="value">{lines.length}</div>
            </div>
            <div className="metric">
              <div className="label">Monthly</div>
              <div className="value"><span className="currency">USD</span>{fmtMoney(totalMonthly)}</div>
            </div>
            <div className="metric">
              <div className="label">Annual</div>
              <div className="value"><span className="currency">USD</span>{fmtMoney(totalMonthly * 12)}</div>
            </div>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <button className="primary" style={{ width: "100%" }} onClick={() => void downloadExcel()}>
              <Download size={16} /> Download Excel (full breakdown)
            </button>
          </div>

          <div className="kbd-stack">
            {grouped.map(([category, rows], idx) => {
              const subtotal = sumMonthly(rows);
              return (
                <details className="category-group" key={category} open={idx === 0}>
                  <summary>
                    <span className="cat-name">{category || "Other"}</span>
                    <span />
                    <span className="cat-count">{rows.length} line{rows.length === 1 ? "" : "s"}</span>
                    <span className="cat-subtotal">${fmtMoney(subtotal)} / mo</span>
                  </summary>
                  <div className="group-body">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Resource</th>
                            <th className="num">Qty</th>
                            <th>Billing</th>
                            <th className="num">Monthly cost</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((l, i) => (
                            <tr key={i}>
                              <td>{l.resource}</td>
                              <td className="num">{l.resourceCount}</td>
                              <td>{l.billingTerm}</td>
                              <td className="num">${fmtMoney(l.monthlyCost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>

          <p className="helper" style={{ marginTop: "0.75rem", textAlign: "center" }}>
            Full breakdown — SKU, meter, unit price, region, assumptions — is in the Excel export.
          </p>
        </section>
      )}

      <footer>
        Built with Next.js · Live prices from the{" "}
        <a href="https://prices.azure.com/api/retail/prices" target="_blank" rel="noopener">
          Azure Retail Prices API
        </a>{" "}
        · Powered by Claude
      </footer>
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
