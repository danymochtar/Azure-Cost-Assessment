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

export function recommendDiskTier(item: InventoryItem, fallback = "Standard SSD"): string {
  const haystack = [
    (item.name ?? "").toLowerCase(),
    (item.os ?? "").toLowerCase(),
    (item.notes ?? "").toLowerCase(),
  ].join(" ");
  if (DB_TOKENS.some((t) => haystack.includes(t))) return "Premium SSD";
  if (HDD_TOKENS.some((t) => haystack.includes(t))) return "Standard HDD";
  return fallback;
}
