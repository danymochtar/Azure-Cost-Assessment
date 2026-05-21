"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, AlertTriangle, BadgeCheck, Calculator, Cloud, Download,
  FileText, Files, FolderOpen, Loader2, LogOut, Receipt, RefreshCcw, Save,
  Search, Server, Settings2, Sparkles, Trash2, UploadCloud,
  User as UserIcon, X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Tooltip } from "@/components/Tooltip";
import { DEFAULT_REGION, regionLabel, regionsByGeography } from "@/lib/constants";
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

// The 7 first-class Azure assessment pillars. Lift-shift is the only
// one fully implemented today — the others show as "not yet priced"
// in the picker but can still be flagged as in-scope so the user
// captures the multi-pillar nature of a mixed project.
const ALL_PILLARS = [
  "infra_lift_shift",
  "infra_modernization",
  "data_platform",
  "ai_application",
  "azure_security",
  "hybrid_multicloud",
  "m365_and_others",
] as const;
type PillarKey = (typeof ALL_PILLARS)[number];

const PORTED_PILLARS: ReadonlySet<string> = new Set(["infra_lift_shift"]);

// Map a `suggested_components` key (returned by the classifier) → owning
// pillar. Mirrors the COMPONENT_TO_PILLAR mapping from the Python source
// so the multi-select pre-ticks correctly for a "mixed" classification.
const COMPONENT_TO_PILLAR: Record<string, PillarKey> = {
  // Lift-shift / LZ
  vm_sizing: "infra_lift_shift", managed_disks: "infra_lift_shift",
  public_ip: "infra_lift_shift", firewall: "infra_lift_shift",
  bastion: "infra_lift_shift", vpn_gw: "infra_lift_shift",
  expressroute_circuit: "infra_lift_shift",
  expressroute_gateway: "infra_lift_shift",
  app_gateway_waf: "infra_lift_shift",
  bandwidth_egress: "infra_lift_shift",
  log_analytics: "infra_lift_shift", key_vault: "infra_lift_shift",
  recovery_vault: "infra_lift_shift",
  ha: "infra_lift_shift", bcdr: "infra_lift_shift",
  nat_gateway: "infra_lift_shift",
  // Modernization
  app_service: "infra_modernization", aks: "infra_modernization",
  container_apps: "infra_modernization", api_management: "infra_modernization",
  front_door: "infra_modernization", acr: "infra_modernization",
  service_bus: "infra_modernization",
  github_enterprise: "infra_modernization",
  github_advanced_security: "infra_modernization",
  github_copilot_business: "infra_modernization",
  github_copilot_enterprise: "infra_modernization",
  visual_studio_pro: "infra_modernization",
  visual_studio_enterprise: "infra_modernization",
  azdo_basic: "infra_modernization", azdo_basic_test: "infra_modernization",
  azdo_hosted_pipeline: "infra_modernization",
  azdo_selfhosted_pipeline: "infra_modernization",
  // Data
  fabric: "data_platform", synapse: "data_platform",
  cosmos_db: "data_platform", azure_sql_db: "data_platform",
  sql_mi: "data_platform", adls_gen2: "data_platform",
  adf: "data_platform", event_hubs: "data_platform",
  databricks: "data_platform", power_bi: "data_platform",
  postgres_flexible: "data_platform", mysql_flexible: "data_platform",
  redis_cache: "data_platform", azure_files: "data_platform",
  // AI
  azure_openai: "ai_application", ai_search: "ai_application",
  ml_workspace: "ai_application", gpu_vm: "ai_application",
  cognitive_services: "ai_application", fine_tuning: "ai_application",
  // Security
  defender_cspm: "azure_security", defender_servers_p2: "azure_security",
  sentinel: "azure_security", waf: "azure_security",
  private_link: "azure_security", purview: "azure_security",
  pim: "azure_security",
  ddos_ip_protection: "azure_security",
  ddos_network_protection: "azure_security",
  // Hybrid
  azure_arc: "hybrid_multicloud", defender_multicloud: "hybrid_multicloud",
  arc_sql_payg: "hybrid_multicloud",
  arc_winserver_payg: "hybrid_multicloud",
  arc_k8s: "hybrid_multicloud", arc_la_ingestion: "hybrid_multicloud",
  // M365 & Others
  m365_backup: "m365_and_others", m365_archive: "m365_and_others",
  sharepoint_premium: "m365_and_others",
  copilot_studio_pack_25k: "m365_and_others",
  copilot_studio_payg: "m365_and_others",
  other_marketplace: "m365_and_others",
};

/**
 * Microsoft Solution Areas — the official Microsoft taxonomy used to
 * categorise Azure / M365 / D365 projects in the partner ecosystem.
 *
 * Reference: https://learn.microsoft.com/en-us/partner-center/membership/
 * (Solution Areas: Azure Infrastructure, Digital & App Innovation,
 *  Data & AI, Security, Modern Work, Business Applications.)
 *
 * The 7 internal pillar keys map into 5 Solution Areas. The "Modern
 * Work" and "Business Applications" Solution Areas are merged here
 * since they share a single TS pillar (m365_and_others).
 */
const SOLUTION_AREAS = [
  {
    key: "azure_infrastructure",
    label: "Azure Infrastructure",
    blurb: "Migrate-to-Azure, hybrid, multicloud, DR",
    pillars: ["infra_lift_shift", "hybrid_multicloud"],
  },
  {
    key: "digital_app_innovation",
    label: "Digital & App Innovation",
    blurb: "App modernization, AKS, App Service, APIs",
    pillars: ["infra_modernization"],
  },
  {
    key: "data_and_ai",
    label: "Data & AI",
    blurb: "Fabric, Synapse, Cosmos, Azure OpenAI, ML",
    pillars: ["data_platform", "ai_application"],
  },
  {
    key: "security",
    label: "Security",
    blurb: "Defender, Sentinel, Entra, Purview",
    pillars: ["azure_security"],
  },
  {
    key: "modern_work_business_apps",
    label: "Modern Work & Business Apps",
    blurb: "M365 Backup, SharePoint Premium, Copilot Studio",
    pillars: ["m365_and_others"],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  blurb: string;
  pillars: readonly PillarKey[];
}>;

function seedPillarsFromProfile(p: AssessmentProfile): Set<PillarKey> {
  const seeded = new Set<PillarKey>();
  if (
    p.workloadType !== "mixed" &&
    p.workloadType !== "unknown" &&
    (ALL_PILLARS as readonly string[]).includes(p.workloadType)
  ) {
    seeded.add(p.workloadType as PillarKey);
  }
  for (const c of p.suggestedComponents) {
    const pk = COMPONENT_TO_PILLAR[c];
    if (pk) seeded.add(pk);
  }
  if (seeded.size === 0) seeded.add("infra_lift_shift");
  return seeded;
}

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
  const [customer, setCustomer] = useState("");
  const [appName, setAppName] = useState("");
  const [region, setRegion] = useState<string>(DEFAULT_REGION);
  const [pricingMode, setPricingMode] = useState<PricingMode>("payg");
  const [computeMode, setComputeMode] = useState<ComputeMode>("normal");
  const [useAhbWindows, setUseAhbWindows] = useState(false);
  const [nonProdPayg, setNonProdPayg] = useState(true);
  const [diskTier, setDiskTier] = useState<"Premium SSD" | "Standard SSD" | "Standard HDD">("Standard SSD");
  const [autoDiskTier, setAutoDiskTier] = useState(true);
  // Safety margin is opt-in. When `applyHeadroom` is false we pass 1.0
  // (exact 1:1 sizing) to the API; only when the checkbox is on does
  // the `headroom` value get used.
  const [applyHeadroom, setApplyHeadroom] = useState(false);
  const [headroom, setHeadroom] = useState(1.2);

  const [profile, setProfile] = useState<AssessmentProfile | null>(null);
  const [perFile, setPerFile] = useState<PerFile[]>([]);
  const [activePillars, setActivePillars] = useState<Set<PillarKey>>(new Set());
  // Snapshot of what the classifier auto-detected — so we can render a
  // "(detected)" badge for those and not for ones the user added manually.
  const [detectedPillars, setDetectedPillars] = useState<Set<PillarKey>>(new Set());
  // Explicit stage confirmations. Each stage requires the user to hit
  // its confirm button before the next stage unlocks. Earlier stages
  // remain editable; the user just re-confirms to propagate changes.
  const [stage1Confirmed, setStage1Confirmed] = useState(false);
  const [stage2Confirmed, setStage2Confirmed] = useState(false);

  // Saved projects (Postgres-backed). Empty while DB is unavailable.
  interface SavedProject { id: string; customer: string; name: string; region: string; updatedAt: string }
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [savingProject, setSavingProject] = useState(false);
  const [savedToast, setSavedToast] = useState("");
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

  // Editable inventory helpers — wired into the Stage 2 table.
  const updateItem = useCallback((idx: number, partial: Partial<InventoryItem>) => {
    setItems((curr) => curr.map((it, i) => (i === idx ? { ...it, ...partial } : it)));
  }, []);
  const deleteItem = useCallback((idx: number) => {
    setItems((curr) => curr.filter((_, i) => i !== idx));
  }, []);
  const addBlankItem = useCallback(() => {
    setItems((curr) => [
      ...curr,
      {
        name: "New server",
        vcpu: 2,
        memoryGb: 4,
        storageGb: 64,
        os: "Linux",
        environment: "prod",
        powerstate: "poweredOn",
        notes: "Manually added",
        disks: [],
        hasDb: false,
      },
    ]);
  }, []);

  // If the user clears every file + paste content after having already
  // analyzed, snap the whole page back to a clean Stage 1 — Stage 2/3/4
  // should not linger with stale classification or BOM data.
  useEffect(() => {
    const empty = files.length === 0 && !pastedText.trim();
    if (empty && (stage1Confirmed || stage2Confirmed || items.length > 0 || lines.length > 0)) {
      setStage1Confirmed(false);
      setStage2Confirmed(false);
      setProfile(null);
      setPerFile([]);
      setActivePillars(new Set());
      setDetectedPillars(new Set());
      setItems([]);
      setLines([]);
      setError("");
      setWarnings([]);
    }
  }, [files.length, pastedText, stage1Confirmed, stage2Confirmed, items.length, lines.length]);

  // Claude-chat-style paste: anywhere on the page, paste an image, file,
  // or text from the clipboard. Files / images land in the file list;
  // text goes into the pasted-content textarea (default browser behaviour
  // when the textarea is focused). We only intercept when the clipboard
  // carries actual file items.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const dt = e.clipboardData;
      if (!dt) return;

      const dropped: File[] = [];
      for (const item of Array.from(dt.items)) {
        if (item.kind !== "file") continue;
        const f = item.getAsFile();
        if (!f) continue;
        // Browsers often hand clipboard images a generic name like
        // "image.png". Stamp a timestamp + the type's extension so
        // multiple pastes don't collide in the file list.
        const ext = (f.type.split("/")[1] || "bin").toLowerCase();
        const looksGeneric = !f.name || /^image(\.\w+)?$/i.test(f.name);
        const stamped = looksGeneric
          ? new File([f], `pasted-${Date.now()}.${ext}`, { type: f.type })
          : f;
        dropped.push(stamped);
      }
      if (dropped.length === 0) return;

      // We're handling these — prevent the default plain-text paste
      // (which would try to insert binary into the focused input).
      e.preventDefault();
      setFiles((curr) => [...curr, ...dropped.map((file) => ({ file }))]);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

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
    setActivePillars(new Set());
    setDetectedPillars(new Set());
    setStage1Confirmed(false);
    setStage2Confirmed(false);
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

  // ----- Saved projects ---------------------------------------------------
  const refreshProjects = useCallback(async () => {
    try {
      const resp = await fetch("/api/projects", { cache: "no-store" });
      if (!resp.ok) return;
      const data = (await resp.json()) as { projects?: SavedProject[]; dbDisabled?: boolean };
      setSavedProjects(data.projects ?? []);
    } catch {
      /* silent — projects panel just won't appear */
    }
  }, []);

  useEffect(() => {
    void refreshProjects();
  }, [refreshProjects]);

  async function saveCurrentProject() {
    if (!customer.trim() || !appName.trim()) {
      setError("Set both Customer and Project name in Stage 1 before saving.");
      return;
    }
    setSavingProject(true);
    setError("");
    try {
      const resp = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer: customer.trim(),
          name: appName.trim(),
          region,
          pricingMode,
          computeMode,
          useAhbWindows,
          nonProdPayg,
          defaultDiskTier: diskTier,
          autoDiskTier,
          applyHeadroom,
          headroom,
          activePillars: Array.from(activePillars),
          items,
          lines,
        }),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Save failed (HTTP ${resp.status})`);
      }
      const data = (await resp.json()) as { project?: { customer?: string; name: string } };
      const savedLabel = data.project?.customer
        ? `${data.project.customer} · ${data.project.name}`
        : data.project?.name ?? appName;
      setSavedToast(`Saved "${savedLabel}"`);
      await refreshProjects();
      // Auto-clear toast after a few seconds
      setTimeout(() => setSavedToast(""), 3500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSavingProject(false);
    }
  }

  async function loadProject(id: string) {
    setError("");
    try {
      const resp = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      if (!resp.ok) throw new Error(`Load failed (HTTP ${resp.status})`);
      const data = (await resp.json()) as { project: {
        customer: string; name: string; region: string; pricingMode: string; computeMode: string;
        useAhbWindows: boolean; nonProdPayg: boolean; defaultDiskTier: string;
        autoDiskTier: boolean; applyHeadroom: boolean; headroom: number;
        activePillars: string[]; items: InventoryItem[]; lines: BomLine[];
      } };
      const p = data.project;
      setCustomer(p.customer ?? "");
      setAppName(p.name);
      setRegion(p.region);
      setPricingMode(p.pricingMode as PricingMode);
      setComputeMode(p.computeMode as ComputeMode);
      setUseAhbWindows(p.useAhbWindows);
      setNonProdPayg(p.nonProdPayg);
      setDiskTier(p.defaultDiskTier as typeof diskTier);
      setAutoDiskTier(p.autoDiskTier);
      setApplyHeadroom(p.applyHeadroom);
      setHeadroom(p.headroom);
      setActivePillars(new Set(p.activePillars as PillarKey[]));
      setDetectedPillars(new Set());
      setItems(p.items ?? []);
      setLines(p.lines ?? []);
      // We have items + lines — jump straight to the latest stage available
      setStage1Confirmed((p.items ?? []).length > 0);
      setStage2Confirmed((p.lines ?? []).length > 0);
      setSavedToast(`Loaded "${p.customer ? `${p.customer} · ` : ""}${p.name}"`);
      setTimeout(() => setSavedToast(""), 3500);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function deleteProject(id: string, name: string) {
    if (!confirm(`Delete saved project "${name}"? This can't be undone.`)) return;
    try {
      const resp = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!resp.ok) throw new Error(`Delete failed (HTTP ${resp.status})`);
      await refreshProjects();
    } catch (e) {
      setError((e as Error).message);
    }
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
      const seeded = seedPillarsFromProfile(data.profile);
      setActivePillars(seeded);
      setDetectedPillars(new Set(seeded));
      // Stage 1 complete — unlock Stage 2. Reset Stage 2 confirmation
      // so the user has to explicitly accept the new scope before
      // Stage 3 reappears.
      setStage1Confirmed(true);
      setStage2Confirmed(false);

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
            defaultDiskTier: diskTier, autoDiskTier, appName,
            headroom: applyHeadroom ? headroom : 1.0,
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

      {savedProjects.length > 0 && (
        <div className="saved-projects-bar">
          <span className="saved-projects-label">
            <FolderOpen size={14} /> Saved projects
          </span>
          <div className="saved-projects-list">
            {savedProjects.map((p) => {
              const label = p.customer ? `${p.customer} · ${p.name}` : p.name;
              return (
                <span key={p.id} className="saved-project-pill">
                  <button
                    type="button"
                    className="saved-project-load"
                    title={`Load "${label}" — last updated ${new Date(p.updatedAt).toLocaleString()}`}
                    onClick={() => void loadProject(p.id)}
                  >
                    {label}
                  </button>
                  <button
                    type="button"
                    className="saved-project-del"
                    title="Delete"
                    aria-label={`Delete ${label}`}
                    onClick={() => void deleteProject(p.id, label)}
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {savedToast && (
        <div className="banner success" role="status">
          <BadgeCheck size={16} className="icon" />
          <span>{savedToast}</span>
        </div>
      )}

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
         Stage 1 — Gather information
         Upload files, paste content, name the project. The CTA
         triggers classification + extraction and unlocks Stage 2.
         ============================================================ */}
      <section className="card">
        <div className="section-head">
          <span className="stage-icon" aria-hidden>
            <Search size={18} strokeWidth={2.2} />
          </span>
          <span className="stage-title">
            <span className="stage-label">Stage 1</span>
            <h2>Gather information</h2>
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
          <strong>Tap, drop, or paste anywhere</strong>
          <span className="hint">Excel · CSV · PDF · Word · image · text · ≤ {MAX_TOTAL_UPLOAD_MB} MB total</span>
          <span className="hint">⌘V / Ctrl+V works for screenshots and files too</span>
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

        {/* Customer + project name live in Stage 1 — both are required
            so saved assessments have a stable identity for reload/delete.
            The (customer, project) pair is the unique key per user. */}
        <div className="field" style={{ marginTop: "1rem" }}>
          <label className="field-label" htmlFor="customer">
            Customer <span style={{ color: "#d13438" }}>*</span>
            <Tooltip
              label="Customer"
              content="The end customer or account this assessment belongs to. Combined with the project name to namespace saved assessments — two different customers can have a project with the same name."
            />
          </label>
          <input
            id="customer"
            type="text"
            required
            aria-required="true"
            value={customer}
            onChange={(e) => setCustomer(e.target.value)}
            placeholder="e.g. Contoso, Northwind"
          />
        </div>
        <div className="field" style={{ marginTop: "1rem" }}>
          <label className="field-label" htmlFor="appName">
            Application / project name <span style={{ color: "#d13438" }}>*</span>
            <Tooltip
              label="Application name"
              content="Tagged into the Custom name column of every line in the Excel export so multi-project BOMs stay traceable."
            />
          </label>
          <input
            id="appName"
            type="text"
            required
            aria-required="true"
            value={appName}
            onChange={(e) => setAppName(e.target.value)}
            placeholder="e.g. ERPSuite, FraudAI"
          />
        </div>

        {/* Stage 1 CTA — kicks off classification + extraction. */}
        <div style={{ marginTop: "1.25rem" }}>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={
              stage !== "idle" ||
              tooLarge ||
              (files.length === 0 && !pastedText.trim()) ||
              !customer.trim() ||
              !appName.trim()
            }
            onClick={() => void runAnalyze()}
          >
            {stage === "classifying" || stage === "extracting" ? (
              <><Loader2 size={16} className="spin" /> {loadingLabel(stage)}</>
            ) : (
              <><Sparkles size={16} /> {stage1Confirmed ? "Re-analyze workload" : "Confirm inputs · Analyze"}</>
            )}
          </button>
        </div>
      </section>

      {/* ============================================================
         Stage 2 — Workload classification
         Gated: only appears once Stage 1's analyze succeeded.
         Lets the user accept or refine the AI's classification before
         moving on to Design parameters.
         ============================================================ */}
      {stage1Confirmed && profile && (
      <section className="card">
        <div className="section-head">
          <span className="stage-icon" aria-hidden>
            <Receipt size={18} strokeWidth={2.2} />
          </span>
          <span className="stage-title">
            <span className="stage-label">Stage 2</span>
            <h2>Workload classification</h2>
          </span>
        </div>

        <h3 style={{ marginBottom: "0.5rem" }}>Detected by AI</h3>
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

        {/* Microsoft Solution Areas — grouped pillar picker. */}
        <div className="pillar-picker">
          <div className="pillar-picker-head">
            <h4>
              Solution areas in scope
              <Tooltip
                label="Microsoft Solution Areas"
                content="Microsoft's official Solution Area taxonomy: Azure Infrastructure, Digital & App Innovation, Data & AI, Security, Modern Work & Business Apps. The AI pre-ticked what it detected; expand or trim for a mixed project. Pillars marked 'not yet priced' are recorded as scope but won't add BOM lines yet."
              />
            </h4>
            <span className="badge muted">{activePillars.size} of {ALL_PILLARS.length}</span>
          </div>
          <div className="solution-areas">
            {SOLUTION_AREAS.map((sa) => (
              <div className="solution-area" key={sa.key}>
                <div className="solution-area-head">
                  <strong>{sa.label}</strong>
                  <span className="solution-area-blurb">{sa.blurb}</span>
                </div>
                <div className="pillar-list">
                  {sa.pillars.map((pk) => {
                    const active = activePillars.has(pk);
                    const wasDetected = detectedPillars.has(pk);
                    const ported = PORTED_PILLARS.has(pk);
                    return (
                      <label key={pk} className="checkbox-row pillar-row">
                        <input
                          type="checkbox"
                          checked={active}
                          onChange={(e) => {
                            setActivePillars((curr) => {
                              const next = new Set(curr);
                              if (e.target.checked) next.add(pk);
                              else next.delete(pk);
                              return next;
                            });
                          }}
                        />
                        <span className="pillar-name">{PILLAR_LABELS[pk]}</span>
                        {wasDetected && <span className="badge success">detected</span>}
                        {!ported && <span className="badge muted">not yet priced</span>}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

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

        {/* Extracted resources fold into Stage 2 so the user can sanity-
            check the inventory before moving to Design parameters.
            Every field is editable — fix bad extractions, add VMs the AI
            missed, flag database servers explicitly. */}
        {(items.length > 0 || stage1Confirmed) && (
          <div style={{ marginTop: "1.25rem" }}>
            <h3 style={{ marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              Extracted resources
              <span className="badge muted">
                <Server size={12} /> {items.length} virtual machines
              </span>
            </h3>
            <p className="helper" style={{ marginTop: "-0.25rem", marginBottom: "0.5rem" }}>
              Click any cell to edit. Use the DB checkbox for database servers — that pins disk routing to Premium SSD and (when ported) drives SQL Server licensing.
            </p>
            <div className="table-wrap scroll-y">
              <table className="inv-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th className="num">
                      vCPU
                      <Tooltip
                        label="vCPU vs core"
                        content="Azure provisions in vCPUs. 1 vCPU = 1 logical CPU (thread). If your inventory lists physical cores, multiply by 2 when hyperthreading is on. For Azure SQL DB, vCores map 1:1 to logical CPUs."
                      />
                    </th>
                    <th className="num">Memory (GB)</th>
                    <th className="num">Storage (GB)</th>
                    <th>OS</th>
                    <th>Env</th>
                    <th>
                      DB
                      <Tooltip
                        label="Database flag"
                        content="Tick if this server runs a database (SQL Server, Postgres, MySQL, Oracle, Mongo, etc.). Forces Premium SSD for the disks and signals SQL Server licensing for future pricing passes."
                      />
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td>
                        <input
                          type="text"
                          className="inv-input inv-name"
                          value={it.name}
                          onChange={(e) => updateItem(idx, { name: e.target.value })}
                          placeholder="Server name"
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          className="inv-input inv-num"
                          value={it.vcpu}
                          onChange={(e) => updateItem(idx, { vcpu: Math.max(0, Number(e.target.value) | 0) })}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          className="inv-input inv-num"
                          value={it.memoryGb}
                          onChange={(e) => updateItem(idx, { memoryGb: Math.max(0, Number(e.target.value)) })}
                        />
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min={0}
                          step={10}
                          className="inv-input inv-num"
                          value={it.storageGb}
                          onChange={(e) => updateItem(idx, { storageGb: Math.max(0, Number(e.target.value)), disks: [] })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="inv-input inv-os"
                          value={it.os}
                          onChange={(e) => updateItem(idx, { os: e.target.value })}
                          placeholder="Linux / Windows"
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          className="inv-input inv-env"
                          value={it.environment}
                          onChange={(e) => updateItem(idx, { environment: e.target.value })}
                          placeholder="prod / uat / dev"
                        />
                      </td>
                      <td className="cell-checkbox">
                        <input
                          type="checkbox"
                          checked={!!it.hasDb}
                          onChange={(e) => updateItem(idx, { hasDb: e.target.checked })}
                          aria-label="Database server"
                        />
                      </td>
                      <td className="cell-remove">
                        <button
                          className="danger-ghost"
                          onClick={() => deleteItem(idx)}
                          aria-label={`Remove ${it.name}`}
                          title="Remove"
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button
              onClick={addBlankItem}
              style={{ marginTop: "0.6rem" }}
              type="button"
            >
              + Add server
            </button>
          </div>
        )}

        {/* Stage 2 CTA — advances the flow to Stage 3.
            Gated on at least one valid VM AND at least one pillar in scope.
            Editing the inventory after confirm doesn't auto-unconfirm
            (otherwise small tweaks to RAM would hide Stage 3); the user
            re-clicks confirm if they want fresh propagation. */}
        <div style={{ marginTop: "1.25rem" }}>
          <button
            className="primary"
            style={{ width: "100%" }}
            disabled={
              activePillars.size === 0 ||
              (items.length > 0 && items.every((i) => i.vcpu === 0 && i.memoryGb === 0))
            }
            onClick={() => setStage2Confirmed(true)}
          >
            <BadgeCheck size={16} />{" "}
            {stage2Confirmed ? "Confirmed — scroll to design ▾" : "Confirm scope · Continue to design"}
          </button>
          {items.length > 0 && items.every((i) => i.vcpu === 0 && i.memoryGb === 0) && (
            <p className="helper" style={{ color: "var(--danger)", marginTop: "0.4rem" }}>
              Every VM has 0 vCPU and 0 GB memory. Fix the inventory above before continuing — Stage 3 won&apos;t produce a meaningful estimate.
            </p>
          )}
        </div>
      </section>
      )}

      {/* ============================================================
         Stage 3 — Design parameters
         Gated: only appears once Stage 2's scope is confirmed.
         ============================================================ */}
      {stage1Confirmed && stage2Confirmed && (
      <section className="card">
        <div className="section-head">
          <span className="stage-icon" aria-hidden>
            <Settings2 size={18} strokeWidth={2.2} />
          </span>
          <span className="stage-title">
            <span className="stage-label">Stage 3</span>
            <h2>Design parameters</h2>
          </span>
        </div>

        <div className="row cols-3">
          <div className="field">
            <label className="field-label" htmlFor="region">
              Primary region
              <Tooltip
                label="Primary region"
                content="Where the workload runs. Affects retail meter selection — APAC regions like Malaysia West auto-fall-back to Southeast Asia when meters aren't published."
              />
            </label>
            <select id="region" value={region} onChange={(e) => setRegion(e.target.value)}>
              {regionsByGeography().map(({ geography, regions }) => (
                <optgroup key={geography} label={geography}>
                  {regions.map((r) => (
                    <option key={r} value={r}>{regionLabel(r)}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="compute">
              Optimization profile
              <Tooltip
                label="Optimization profile"
                content="Steers AI tier and SKU recommendations across every service — VMs, App Service, SQL, Cosmos, AI models, Redis. Cost-saving picks the cheapest viable tier (Burstable / Basic / Serverless where supported). Balanced is the production-grade default. Performance picks premium, memory-optimised, or GPU-ready tiers."
              />
            </label>
            <select id="compute" value={computeMode} onChange={(e) => setComputeMode(e.target.value as ComputeMode)}>
              <option value="saving">Cost-saving</option>
              <option value="normal">Balanced (recommended)</option>
              <option value="high_perf">Performance</option>
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

        <div className="row" style={{ marginTop: "1rem" }}>
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
            <label className="checkbox-row">
              <input type="checkbox" checked={applyHeadroom} onChange={(e) => setApplyHeadroom(e.target.checked)} />
              <span>Apply safety margin (capacity headroom)</span>
              <Tooltip
                label="Safety margin"
                content="Off = exact 1:1 sizing (cost-optimised, default). On = +20% padding on vCPU + memory for bursty workloads. Push higher (up to 1.5) for latency-sensitive prod."
              />
            </label>
            {applyHeadroom && (
              <div className="reveal-field">
                <label className="field-label" htmlFor="headroom">Multiplier</label>
                <input
                  id="headroom"
                  type="number"
                  min={1.05}
                  max={2.0}
                  step={0.05}
                  value={headroom}
                  onChange={(e) => setHeadroom(Number(e.target.value))}
                />
              </div>
            )}
          </div>
        </div>

        {/* Stage 3 CTA — runs pricing and reveals Stage 4. */}
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
              <><Calculator size={16} /> {lines.length > 0 ? "Re-generate estimate" : "Generate estimate"}</>
            )}
          </button>
        </div>
      </section>
      )}

      {/* ============================================================
         Stage 4 — Cost estimate
         ============================================================ */}
      {lines.length > 0 && (
        <section className="card" style={{ marginTop: "1.5rem" }}>
          <div className="section-head">
            <span className="stage-icon" aria-hidden>
              <Calculator size={18} strokeWidth={2.2} />
            </span>
            <span className="stage-title">
              <span className="stage-label">Stage 4</span>
              <h2>Cost estimate</h2>
            </span>
          </div>

          {activePillars.size > 0 && (
            <div className="scope-note">
              <strong>Scope:</strong>{" "}
              {Array.from(activePillars)
                .map((pk) => PILLAR_LABELS[pk])
                .join(" · ")}
              {Array.from(activePillars).some((pk) => !PORTED_PILLARS.has(pk)) && (
                <>
                  {" — "}
                  <span className="scope-note-todo">
                    {Array.from(activePillars)
                      .filter((pk) => !PORTED_PILLARS.has(pk))
                      .map((pk) => PILLAR_LABELS[pk])
                      .join(", ")}{" "}
                    not yet priced (TODO; tracked in docs/PORTING-ROADMAP.md)
                  </span>
                </>
              )}
            </div>
          )}

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
              <Download size={16} /> Download Excel (full breakdown)
            </button>
            <button onClick={() => void saveCurrentProject()} disabled={savingProject || !customer.trim() || !appName.trim()}>
              {savingProject ? (
                <><Loader2 size={16} className="spin" /> Saving…</>
              ) : (
                <><Save size={16} /> Save assessment</>
              )}
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
