"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AZURE_REGIONS, DEFAULT_REGION, regionLabel } from "@/lib/constants";
import type { AssessmentProfile, BomLine, ComputeMode, InventoryItem, PricingMode } from "@/lib/models";

// Vercel Hobby caps the HTTP request body at 4.5 MB; pasted text + small
// multipart uploads sit well under that. Multi-file uploads share the
// budget so we surface a clear error before the request fires.
const MAX_TOTAL_UPLOAD_MB = 4;

type UploadedFile = { file: File };

const PILLAR_LABELS: Record<string, string> = {
  infra_lift_shift: "🖥 Infra Lift-and-Shift",
  infra_modernization: "🚀 Infra Modernization (TODO)",
  data_platform: "🗄 Data Platform (TODO)",
  ai_application: "🤖 AI Application (TODO)",
  azure_security: "🛡 Azure Security (TODO)",
  hybrid_multicloud: "🌐 Hybrid Multicloud (TODO)",
  m365_and_others: "📦 M365 & Others (TODO)",
  mixed: "Mixed",
  unknown: "Unknown",
};

interface PerFile { filename: string; profile: AssessmentProfile | null; error?: string }

export default function Page() {
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

  async function runClassify() {
    const fd = buildFormData();
    if (!fd) {
      setError("Add at least one file or paste content before running.");
      return;
    }
    if (tooLarge) {
      setError(
        `Combined upload size ${(totalBytes / 1024 / 1024).toFixed(1)} MB exceeds the ${MAX_TOTAL_UPLOAD_MB} MB limit.`,
      );
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
      } else {
        setWarnings([
          `Detected pillar "${PILLAR_LABELS[data.profile.workloadType] ?? data.profile.workloadType}". ` +
            "Only the Infra Lift-and-Shift pillar is implemented in this TypeScript port. " +
            "See README.md and docs/PORTING-ROADMAP.md.",
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
            region,
            pricingMode,
            computeMode,
            useAhbWindows,
            nonProdPayg,
            defaultDiskTier: diskTier,
            autoDiskTier,
            appName,
            headroom,
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
          category: l.category,
          resource: l.resource,
          sku: l.sku,
          meter: l.meter,
          region: l.region,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          monthlyCost: l.monthlyCost,
          productId: l.productId,
          skuId: l.skuId,
          meterId: l.meterId,
        })),
      },
      null,
      2,
    );
    const blob = new Blob([json], { type: "application/json" });
    const safeApp = appName.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "") || "assessment";
    triggerDownload(blob, `azure-${safeApp}-${region}.json`);
  }

  const totalMonthly = useMemo(() => lines.reduce((s, l) => s + l.monthlyCost, 0), [lines]);

  return (
    <div className="container">
      <header className="hero">
        <span className="cloud">☁</span>
        <h1>Azure Cost Assessment</h1>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={resetAll} title="Clear everything and start over">Reset</button>
        </div>
      </header>
      <p className="subtitle">
        Upload anything — VM inventory, SIEM design doc, AI use-case, mixed architecture — get a live-priced Azure BOM.
      </p>

      {error && <div className="banner error">⚠ {error}</div>}
      {warnings.map((w, i) => (
        <div className="banner warning" key={i}>{w}</div>
      ))}

      {/* Step 1 — Upload */}
      <section className="card">
        <h2 className="section-title">1. Upload workload description(s)</h2>
        <p className="section-caption">
          Excel / CSV / PDF / Word / image / plain text. PDFs and images are read natively by Claude.
          Combined upload limit: {MAX_TOTAL_UPLOAD_MB} MB (Vercel Hobby tier).
        </p>
        <div
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).classList.add("dragover");
          }}
          onDragLeave={(e) =>
            (e.currentTarget as HTMLDivElement).classList.remove("dragover")
          }
          onDrop={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLDivElement).classList.remove("dragover");
            onSelectFiles(e.dataTransfer.files);
          }}
        >
          📁 Click or drop files here (xlsx, csv, pdf, docx, png, jpg, txt, md)
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
                <span>📎 {f.file.name}</span>
                <span className="size">{(f.file.size / 1024).toFixed(1)} KB</span>
                <button onClick={() => removeFile(i)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: "1rem" }}>
          <label className="field-label">
            Or paste content directly (email body, meeting notes, freeform requirements)
          </label>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={5}
            placeholder="Examples: 'We have 50 Linux VMs running PostgreSQL — 8 vCPU / 32 GB each…'"
          />
        </div>

        {totalBytes > 0 && (
          <div className="helper" style={{ marginTop: "0.5rem" }}>
            Total upload: <strong>{(totalBytes / 1024 / 1024).toFixed(2)} MB</strong>
            {tooLarge && <span style={{ color: "var(--danger)" }}> — over {MAX_TOTAL_UPLOAD_MB} MB limit</span>}
          </div>
        )}
      </section>

      {/* Step 2 — Context */}
      <section className="card">
        <h2 className="section-title">2. Assessment context</h2>
        <div className="row">
          <div className="col">
            <label className="field-label">Application / workload name</label>
            <input
              type="text"
              value={appName}
              onChange={(e) => setAppName(e.target.value)}
              placeholder="e.g. ERPSuite, FraudAI"
            />
          </div>
          <div className="col">
            <label className="field-label">Primary region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)}>
              {AZURE_REGIONS.map((r) => (
                <option key={r} value={r}>
                  {regionLabel(r)}
                </option>
              ))}
            </select>
          </div>
          <div className="col">
            <label className="field-label">Compute mode</label>
            <select value={computeMode} onChange={(e) => setComputeMode(e.target.value as ComputeMode)}>
              <option value="saving">💰 Saving — Burstable / Basic</option>
              <option value="normal">⚖ Normal — D-series (default)</option>
              <option value="high_perf">🚀 High Performance — E/F-series</option>
            </select>
          </div>
          <div className="col">
            <label className="field-label">Billing term (VM compute)</label>
            <select value={pricingMode} onChange={(e) => setPricingMode(e.target.value as PricingMode)}>
              <option value="payg">Pay-as-you-go</option>
              <option value="sp_1y">Savings Plan (1 year)</option>
              <option value="sp_3y">Savings Plan (3 years)</option>
              <option value="ri_1y">Reserved Instance (1 year)</option>
              <option value="ri_3y">Reserved Instance (3 years)</option>
            </select>
          </div>
        </div>

        <div className="row" style={{ marginTop: "1rem" }}>
          <div className="col">
            <label className="field-label">Default disk tier</label>
            <select
              value={diskTier}
              onChange={(e) => setDiskTier(e.target.value as typeof diskTier)}
            >
              <option value="Premium SSD">Premium SSD</option>
              <option value="Standard SSD">Standard SSD (recommended)</option>
              <option value="Standard HDD">Standard HDD</option>
            </select>
          </div>
          <div className="col">
            <label className="field-label">Safety margin (headroom multiplier)</label>
            <input
              type="number"
              min={1.0}
              max={2.0}
              step={0.05}
              value={headroom}
              onChange={(e) => setHeadroom(Number(e.target.value))}
            />
            <div className="helper">1.0 = 1:1 exact match. 1.2 = +20% padding.</div>
          </div>
          <div className="col" style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <label>
              <input
                type="checkbox"
                checked={autoDiskTier}
                onChange={(e) => setAutoDiskTier(e.target.checked)}
              />{" "}
              🤖 Auto-route disk tier per VM
            </label>
            <label>
              <input
                type="checkbox"
                checked={useAhbWindows}
                onChange={(e) => setUseAhbWindows(e.target.checked)}
              />{" "}
              Windows Server AHB
            </label>
            <label>
              <input
                type="checkbox"
                checked={nonProdPayg}
                onChange={(e) => setNonProdPayg(e.target.checked)}
                disabled={pricingMode === "payg"}
              />{" "}
              🛡 Keep non-prod VMs on PAYG
            </label>
          </div>
        </div>
      </section>

      <div className="actions">
        <button className="primary" disabled={stage !== "idle" || tooLarge} onClick={() => void runClassify()}>
          {stage === "classifying"
            ? <><span className="spinner" /> Classifying…</>
            : stage === "extracting"
            ? <><span className="spinner" /> Extracting VMs…</>
            : "📊 Classify + Extract"}
        </button>
        <button disabled={stage !== "idle" || items.length === 0} onClick={() => void runPrice()}>
          {stage === "pricing" ? <><span className="spinner" /> Pricing via Azure Retail API…</> : "💵 Price BOM"}
        </button>
      </div>

      {profile && (
        <section className="card" style={{ marginTop: "1.2rem" }}>
          <h2 className="section-title">3. Classification</h2>
          <p style={{ margin: 0 }}>
            <strong>Primary pillar:</strong> {PILLAR_LABELS[profile.workloadType] ?? profile.workloadType}
            {"  ·  "}
            <strong>Confidence:</strong> {(profile.confidence * 100).toFixed(0)}%
            {"  ·  "}
            <strong>Complexity:</strong> {profile.complexity}
          </p>
          {profile.summary && <p className="helper" style={{ marginTop: "0.4rem" }}>{profile.summary}</p>}
          {perFile.length > 1 && (
            <details style={{ marginTop: "0.6rem" }}>
              <summary>Per-file classification ({perFile.length} files)</summary>
              <ul>
                {perFile.map((p, i) => (
                  <li key={i}>
                    {p.error
                      ? <>❌ <code>{p.filename}</code> — {p.error}</>
                      : p.profile
                        ? <>✅ <code>{p.filename}</code> — {PILLAR_LABELS[p.profile.workloadType] ?? p.profile.workloadType} · {(p.profile.confidence * 100).toFixed(0)}%</>
                        : <>⚠️ <code>{p.filename}</code> — no profile</>
                    }
                  </li>
                ))}
              </ul>
            </details>
          )}
          {profile.signals.length > 0 && (
            <details style={{ marginTop: "0.6rem" }}>
              <summary>Why this classification? ({profile.signals.length} signals)</summary>
              <ul>
                {profile.signals.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {items.length > 0 && (
        <section className="card">
          <h2 className="section-title">4. Extracted inventory ({items.length} VMs)</h2>
          <div style={{ overflow: "auto", maxHeight: 360 }}>
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

      {lines.length > 0 && (
        <section className="card">
          <h2 className="section-title">5. Results</h2>
          <div className="metrics">
            <div className="metric">
              <div className="label">Line items</div>
              <div className="value">{lines.length}</div>
            </div>
            <div className="metric">
              <div className="label">Monthly (USD)</div>
              <div className="value">${totalMonthly.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
            <div className="metric">
              <div className="label">Annual (USD)</div>
              <div className="value">${(totalMonthly * 12).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
          </div>

          <div className="actions" style={{ marginBottom: "1rem" }}>
            <button className="primary" onClick={() => void downloadExcel()}>
              📥 Download Excel (Pricing Calculator template)
            </button>
            <button onClick={downloadJson}>📥 Download Pricing Calculator JSON</button>
          </div>

          <div style={{ overflow: "auto", maxHeight: 540 }}>
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Resource</th>
                  <th className="num">#</th>
                  <th>SKU</th>
                  <th>Meter</th>
                  <th>Billing</th>
                  <th className="num">Unit price</th>
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
                    <td className="num">${l.monthlyCost.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer>
        Built with Next.js · Live prices from the{" "}
        <a href="https://prices.azure.com/api/retail/prices">Azure Retail Prices API</a>.{" "}
        Classification + extraction powered by Claude.
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
