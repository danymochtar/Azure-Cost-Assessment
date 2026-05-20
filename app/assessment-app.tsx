"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  AlertCircle, AlertTriangle, BadgeCheck, Calculator, ChevronRight, Cloud,
  Download, FileSpreadsheet, FileText, Files, Loader2, LogOut, RefreshCcw,
  Server, Sparkles, UploadCloud, User as UserIcon, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
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

  async function runClassify() {
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
      if (!resp.ok) throw new Error(`Classify HTTP ${resp.status}: ${await resp.text()}`);
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
          `Detected "${PILLAR_LABELS[data.profile.workloadType] ?? data.profile.workloadType}". Only the Infra Lift-and-Shift pillar is implemented in this build — see docs/PORTING-ROADMAP.md.`,
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
      setError("Need extracted VMs first. Run classify/extract above.");
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
      if (!resp.ok) throw new Error(`Price HTTP ${resp.status}: ${await resp.text()}`);
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

  function downloadJson() {
    const json = JSON.stringify(
      {
        schemaVersion: "1",
        generator: "azure-cost-assessment",
        region,
        currency: "USD",
        totalMonthlyCost: Math.round(lines.reduce((s, l) => s + l.monthlyCost, 0) * 100) / 100,
        items: lines.map((l) => ({
          category: l.category, resource: l.resource, sku: l.sku, meter: l.meter,
          region: l.region, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice,
          monthlyCost: l.monthlyCost, productId: l.productId, skuId: l.skuId, meterId: l.meterId,
        })),
      },
      null, 2,
    );
    const blob = new Blob([json], { type: "application/json" });
    const safeApp = appName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "") || "assessment";
    triggerDownload(blob, `azure-${safeApp}-${region}.json`);
  }

  const totalMonthly = useMemo(() => lines.reduce((s, l) => s + l.monthlyCost, 0), [lines]);
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
        <button className="ghost icon-only" onClick={resetAll} title="Reset all state" aria-label="Reset">
          <RefreshCcw size={18} />
        </button>
        <button className="ghost icon-only" onClick={() => void signOut()} title="Sign out" aria-label="Sign out">
          <LogOut size={18} />
        </button>
      </header>

      <p className="hero-pitch">
        Upload a VM inventory, SIEM design doc, AI use-case or mixed architecture — and get a live-priced Azure BOM with Pricing Calculator–compatible exports.
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

      {/* ---------- Step 1 — Upload ---------- */}
      <section className="card">
        <div className="section-head">
          <span className="num">1</span>
          <h2>Upload workload description(s)</h2>
        </div>
        <p className="section-caption">
          xlsx · csv · pdf · docx · png · jpg · txt · md. PDFs and images are read natively by Claude. Combined upload limit: {MAX_TOTAL_UPLOAD_MB} MB (Vercel Hobby tier).
        </p>

        <div
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.add("dragover"); }}
          onDragLeave={(e) => (e.currentTarget as HTMLDivElement).classList.remove("dragover")}
          onDrop={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).classList.remove("dragover");
            onSelectFiles(e.dataTransfer.files);
          }}
        >
          <UploadCloud className="icon-lg" strokeWidth={1.6} />
          <strong>Tap or drop files</strong>
          <span className="hint">Multi-file supported — combine inventory + meeting notes + screenshots</span>
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
            <Files size={14} /> Or paste content directly
          </label>
          <textarea
            id="pasted"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={4}
            placeholder="e.g. 'We have 50 Linux VMs running PostgreSQL — 8 vCPU / 32 GB each…'"
          />
        </div>

        {totalBytes > 0 && (
          <div className={`upload-total${tooLarge ? " over" : ""}`}>
            <FileSpreadsheet size={14} />
            <span>
              Total upload: <strong>{(totalBytes / 1024 / 1024).toFixed(2)} MB</strong>
              {tooLarge && ` — over ${MAX_TOTAL_UPLOAD_MB} MB limit`}
            </span>
          </div>
        )}
      </section>

      {/* ---------- Step 2 — Context ---------- */}
      <section className="card">
        <div className="section-head">
          <span className="num">2</span>
          <h2>Assessment context</h2>
        </div>
        <div className="row cols-4">
          <div className="field">
            <label className="field-label" htmlFor="appName">Application name</label>
            <input id="appName" type="text" value={appName} onChange={(e) => setAppName(e.target.value)} placeholder="e.g. ERPSuite" />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="region">Primary region</label>
            <select id="region" value={region} onChange={(e) => setRegion(e.target.value)}>
              {AZURE_REGIONS.map((r) => (
                <option key={r} value={r}>{regionLabel(r)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="compute">Compute mode</label>
            <select id="compute" value={computeMode} onChange={(e) => setComputeMode(e.target.value as ComputeMode)}>
              <option value="saving">💰 Saving — Burstable / Basic</option>
              <option value="normal">⚖ Normal — D-series (default)</option>
              <option value="high_perf">🚀 High Performance — E / F-series</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="billing">Billing term</label>
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
            <label className="field-label" htmlFor="diskTier">Default disk tier</label>
            <select id="diskTier" value={diskTier} onChange={(e) => setDiskTier(e.target.value as typeof diskTier)}>
              <option value="Premium SSD">Premium SSD</option>
              <option value="Standard SSD">Standard SSD (recommended)</option>
              <option value="Standard HDD">Standard HDD</option>
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="headroom">Safety margin</label>
            <input id="headroom" type="number" min={1.0} max={2.0} step={0.05} value={headroom} onChange={(e) => setHeadroom(Number(e.target.value))} />
            <div className="helper">1.0 = 1:1 exact match · 1.2 = +20% padding</div>
          </div>
          <div className="col col-stack">
            <label className="checkbox-row">
              <input type="checkbox" checked={autoDiskTier} onChange={(e) => setAutoDiskTier(e.target.checked)} />
              <span>Auto-route disk tier per VM</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={useAhbWindows} onChange={(e) => setUseAhbWindows(e.target.checked)} />
              <span>Windows Server AHB</span>
            </label>
            <label className={`checkbox-row${pricingMode === "payg" ? " disabled" : ""}`}>
              <input type="checkbox" checked={nonProdPayg} onChange={(e) => setNonProdPayg(e.target.checked)} disabled={pricingMode === "payg"} />
              <span>Keep non-prod VMs on PAYG</span>
            </label>
          </div>
        </div>
      </section>

      {/* ---------- Action buttons ---------- */}
      <div className="actions">
        <button className="primary" disabled={stage !== "idle" || tooLarge} onClick={() => void runClassify()}>
          {stage === "classifying" ? (
            <><Loader2 size={16} className="spin" /> Classifying…</>
          ) : stage === "extracting" ? (
            <><Loader2 size={16} className="spin" /> Extracting VMs…</>
          ) : (
            <><Sparkles size={16} /> Classify + Extract</>
          )}
        </button>
        <button disabled={stage !== "idle" || items.length === 0} onClick={() => void runPrice()}>
          {stage === "pricing" ? (
            <><Loader2 size={16} className="spin" /> Pricing…</>
          ) : (
            <><Calculator size={16} /> Price BOM</>
          )}
        </button>
      </div>

      {/* ---------- Step 3 — Classification ---------- */}
      {profile && (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <div className="section-head">
            <span className="num">3</span>
            <h2>Classification</h2>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <span className="badge">
              <BadgeCheck size={12} /> {detectedLabel}
            </span>
            <span className="badge muted">Confidence {(profile.confidence * 100).toFixed(0)}%</span>
            <span className="badge muted">Complexity {profile.complexity}</span>
            {!PORTED_PILLARS.has(profile.workloadType) && profile.workloadType !== "unknown" && (
              <span className="badge danger">Pillar not yet ported</span>
            )}
          </div>
          {profile.summary && <p className="helper" style={{ marginTop: "0.6rem" }}>{profile.summary}</p>}

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
        </section>
      )}

      {/* ---------- Step 4 — Extracted inventory ---------- */}
      {items.length > 0 && (
        <section className="card">
          <div className="section-head">
            <span className="num">4</span>
            <h2>Extracted inventory</h2>
            <span className="badge muted">
              <Server size={12} /> {items.length} VMs
            </span>
          </div>
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
                  <th>Workload</th>
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
                    <td>{it.workload ?? "general"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------- Step 5 — Results ---------- */}
      {lines.length > 0 && (
        <section className="card">
          <div className="section-head">
            <span className="num">5</span>
            <h2>Results</h2>
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

          <div className="actions" style={{ marginBottom: "1rem" }}>
            <button className="primary" onClick={() => void downloadExcel()}>
              <Download size={16} /> Excel (Pricing Calculator template)
            </button>
            <button onClick={downloadJson}>
              <Download size={16} /> Pricing Calculator JSON
            </button>
          </div>

          <div className="table-wrap scroll-y">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Resource</th>
                  <th className="num">#</th>
                  <th>SKU</th>
                  <th>Meter</th>
                  <th>Billing</th>
                  <th className="num">Unit</th>
                  <th className="num">Monthly</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.category}</td>
                    <td>{l.resource}</td>
                    <td className="num">{l.resourceCount}</td>
                    <td><code>{l.sku}</code></td>
                    <td>{l.meter}</td>
                    <td>{l.billingTerm}</td>
                    <td className="num">${l.unitPrice.toFixed(4)}</td>
                    <td className="num">${fmtMoney(l.monthlyCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer>
        Built with Next.js · Live prices from the{" "}
        <a href="https://prices.azure.com/api/retail/prices" target="_blank" rel="noopener">
          Azure Retail Prices API <ChevronRight size={10} style={{ verticalAlign: "middle" }} />
        </a>{" "}
        · Classification + extraction powered by Claude
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
