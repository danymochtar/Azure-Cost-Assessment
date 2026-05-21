import type { ComputeMode, InventoryItem } from "./models";
import { VM_CATALOG, type VmSku } from "./vm-catalog";

export interface DiskRec {
  sku: string;
  tier: string;
  sizeGib: number;
  meterName: string;
}

const DISK_LADDER: Array<[string, number]> = [
  ["P1", 4], ["P2", 8], ["P3", 16], ["P4", 32], ["P6", 64],
  ["P10", 128], ["P15", 256], ["P20", 512], ["P30", 1024], ["P40", 2048],
  ["P50", 4096], ["P60", 8192], ["P70", 16384], ["P80", 32767],
];

const TIER_PREFIX: Record<string, string> = {
  "Premium SSD": "P",
  "Standard SSD": "E",
  "Standard HDD": "S",
};

const NON_PROD_TOKENS = [
  "uat", "test", "dev", "stage", "stg", "staging", "sit",
  "qa", "preprod", "pre-prod", "nonprod", "non-prod",
  "sandbox", "training",
];

const DB_TOKENS = [
  "sql", "mssql", "oracle", "ora-db", "ora db", "postgres", "pg-",
  "mysql", "mariadb", "mongo", "cassandra", "redis", "memcache",
  "elastic", "splunk", "kafka", "rabbitmq", "activemq",
  "saphana", "sap-hana", "hana ", "sap db",
  "-db-", "_db_", "-dbs-", "database", "rdbms", "oltp",
];

const HDD_TOKENS = [
  "backup", "archive", "snapshot", "snap-",
  "file ", "fileserver", "file-server", "nas-", "smb ",
  "ftp", "sftp", "tftp",
  "log-", "_log_", "syslog", "logs ", "log archive",
  "media ", "video ", "image archive", "blob ",
  "tape ", "cold ", "infrequent",
];

export function isNonProd(item: InventoryItem): boolean {
  const haystacks = [item.environment ?? "", item.name ?? ""];
  return haystacks.some((h) => {
    const low = h.toLowerCase();
    return NON_PROD_TOKENS.some((t) => low.includes(t));
  });
}

export function osIsWindows(os: string): boolean {
  return (os ?? "").toLowerCase().includes("win");
}

export function isSqlServer(item: InventoryItem): boolean {
  const haystack = `${item.name ?? ""} ${item.notes ?? ""}`.toLowerCase();
  return [
    "mssql", "ms-sql", "ms_sql",
    "sql server", "sqlserver", "sql-server", "sql_server",
    "-sql-", "_sql_", " sql ",
    "sql-prod", "sql-uat", "sql-dev", "sql-test",
    "sql-cluster",
  ].some((t) => haystack.includes(t));
}

function memoryToCpuRatio(item: InventoryItem): number {
  return item.vcpu > 0 ? item.memoryGb / item.vcpu : 0;
}

export function recommendVm(
  item: InventoryItem,
  headroom = 1.0,
  preferBurstableCpu = 2,
  computeMode: ComputeMode = "normal",
): VmSku {
  const mode: ComputeMode = ["saving", "normal", "high_perf"].includes(computeMode)
    ? computeMode
    : "normal";
  const ratio = memoryToCpuRatio(item);
  const nonProd = isNonProd(item);

  const familyScore = (sku: VmSku): number => {
    if (sku.family === "burstable") {
      if (mode === "saving" && nonProd) return ratio < 6 ? 0 : 3;
      if (mode === "high_perf") return 5;
      return item.vcpu <= preferBurstableCpu && item.memoryGb <= 32 ? 0 : 3;
    }
    if (sku.family === "memory") {
      if (mode === "high_perf") return 0;
      return ratio >= 6 ? 0 : 2;
    }
    // general
    if (mode === "high_perf") return 1;
    if (mode === "saving" && nonProd) return 2;
    return 1;
  };

  // Exact 1:1 match
  if (Math.abs(headroom - 1.0) < 1e-9) {
    const exact = VM_CATALOG.filter(
      (s) => s.vcpu === Math.trunc(item.vcpu) && Math.abs(s.memoryGb - item.memoryGb) < 0.5,
    );
    if (exact.length > 0) {
      exact.sort((a, b) => familyScore(a) - familyScore(b) || a.priority - b.priority);
      return exact[0];
    }
  }

  const reqCpu = Math.max(1, Math.round(item.vcpu * headroom));
  const reqMem = Math.round(item.memoryGb * headroom * 100) / 100;

  const fits = (s: VmSku): boolean => s.vcpu >= reqCpu && s.memoryGb >= reqMem;
  const candidates = VM_CATALOG.filter(fits);
  if (candidates.length === 0) {
    return VM_CATALOG.reduce((a, b) => {
      if (a.vcpu !== b.vcpu) return a.vcpu > b.vcpu ? a : b;
      return a.memoryGb >= b.memoryGb ? a : b;
    });
  }
  candidates.sort(
    (a, b) =>
      familyScore(a) - familyScore(b) ||
      a.vcpu - b.vcpu ||
      a.memoryGb - b.memoryGb ||
      a.priority - b.priority,
  );
  return candidates[0];
}

export function recommendDisk(sizeGb: number, tier = "Premium SSD"): DiskRec {
  const sizeGib = Math.max(4, Math.round(sizeGb));
  const prefix = TIER_PREFIX[tier] ?? "P";
  for (const [code, cap] of DISK_LADDER) {
    if (cap >= sizeGib) {
      const sku = code.replace("P", prefix);
      return { sku, tier, sizeGib: cap, meterName: `${sku} LRS Disk` };
    }
  }
  const [code, cap] = DISK_LADDER[DISK_LADDER.length - 1];
  const sku = code.replace("P", prefix);
  return { sku, tier, sizeGib: cap, meterName: `${sku} LRS Disk` };
}

/**
 * Human-readable justification for the VM SKU pick. Composed off the
 * same memory/vCPU ratio + family rules `recommendVm` uses, so it
 * tracks the heuristic if it ever evolves. Surfaced in the BOM
 * `assumption` so a customer architect can defend the pick:
 * "D8s v5 — general-purpose (mem/cpu ≈ 4:1)."
 */
export function explainVmChoice(item: InventoryItem, sku: VmSku): string {
  const ratio = memoryToCpuRatio(item);
  const ratioStr = `mem/vCPU ≈ ${ratio.toFixed(1)}:1`;
  const nonProd = isNonProd(item);
  const family = sku.family;
  let fit: string;
  if (family === "burstable") {
    fit = nonProd
      ? `burstable B-series (non-prod, small/steady load); credits accrue when idle so cost scales with actual CPU spikes`
      : `burstable B-series (small workload that mostly idles); step up to D-series if sustained CPU > the SKU's baseline`;
  } else if (family === "memory") {
    fit = `memory-optimised E-series (${ratioStr} ≥ 6 means RAM-heavy — typical for in-memory DBs, large JVMs); step down to D-series if ratio drops below 6`;
  } else {
    fit = `general-purpose D-series (${ratioStr} ≈ 4 is the D-series sweet spot); step up to E-series if RAM/vCPU ratio crosses 6, or down to B-series for non-prod/idle workloads`;
  }
  return `${sku.display} → ${fit}.`;
}

/**
 * Human-readable justification for the disk-tier pick. Mirrors
 * `recommendDiskTier` exactly so the explanation can't drift from
 * the rule that was actually applied.
 */
export function explainDiskTierChoice(item: InventoryItem, tier: string): string {
  if (item.hasDb && tier === "Premium SSD") {
    return `Premium SSD — DB checkbox ticked; databases need <1 ms latency and >1k IOPS that Standard SSD can't sustain.`;
  }
  const haystack = [
    (item.name ?? "").toLowerCase(),
    (item.os ?? "").toLowerCase(),
    (item.notes ?? "").toLowerCase(),
  ].join(" ");
  if (tier === "Premium SSD" && DB_TOKENS.some((t) => haystack.includes(t))) {
    const hit = DB_TOKENS.find((t) => haystack.includes(t)) ?? "db";
    return `Premium SSD — name/notes contains "${hit}" (DB workload); needs sub-ms latency. Step down to Standard SSD for stateless app tiers.`;
  }
  if (tier === "Standard HDD" && HDD_TOKENS.some((t) => haystack.includes(t))) {
    const hit = HDD_TOKENS.find((t) => haystack.includes(t)) ?? "log";
    return `Standard HDD — name/notes contains "${hit}" (cold/log/backup workload); cheapest tier with adequate throughput for sequential writes.`;
  }
  if (tier === "Standard SSD") {
    return `Standard SSD — default tier for general workloads; balances cost and throughput. Step up to Premium SSD for DB/latency-sensitive; down to HDD for backup.`;
  }
  if (tier === "Premium SSD") {
    return `Premium SSD — user-selected default. Step down to Standard SSD for stateless tiers if cost matters more than <1 ms latency.`;
  }
  return `${tier} — user-selected default tier.`;
}

export function recommendDiskTier(item: InventoryItem, fallback = "Standard SSD"): string {
  // Explicit user-flag wins — when the operator ticks the DB checkbox
  // in the Stage 2 inventory table, we know for sure this is a DB workload.
  if (item.hasDb) return "Premium SSD";

  const haystack = [
    (item.name ?? "").toLowerCase(),
    (item.os ?? "").toLowerCase(),
    (item.notes ?? "").toLowerCase(),
  ].join(" ");
  if (DB_TOKENS.some((t) => haystack.includes(t))) return "Premium SSD";
  if (HDD_TOKENS.some((t) => haystack.includes(t))) return "Standard HDD";
  return fallback;
}
