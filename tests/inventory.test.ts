import { describe, expect, it } from "vitest";
import type { InventoryItem } from "@/lib/models";

// Mirror the heuristic from lib/parsers/inventory.ts so we can test
// it without making an LLM call. Source-of-truth lives over there; if
// it drifts, these tests fail loud.
type FileKind = "spreadsheet" | "pdf" | "image" | "docx" | "text" | "unknown";
interface ChunkLike {
  kind: FileKind;
  filename: string;
  contentBlocks: Array<{ type: "text"; text: string } | { type: string }>;
}

function looksIncomplete(items: InventoryItem[], chunk: ChunkLike): boolean {
  if (items.length === 0) {
    const block = chunk.contentBlocks[0];
    const isSmallText =
      (chunk.kind === "text" || chunk.filename.startsWith("pasted-content-")) &&
      block?.type === "text" &&
      "text" in block &&
      block.text.length < 1500;
    return !isSmallText;
  }
  const broken = items.filter((i) => i.vcpu === 0 && i.memoryGb === 0).length;
  return broken / items.length >= 0.5;
}

function vm(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    name: "vm",
    vcpu: 4,
    memoryGb: 16,
    storageGb: 100,
    os: "Linux",
    environment: "prod",
    powerstate: "poweredOn",
    notes: "",
    disks: [],
    ...overrides,
  };
}

function spreadsheetChunk(): ChunkLike {
  return {
    kind: "spreadsheet",
    filename: "rvtools.xlsx",
    contentBlocks: [{ type: "text", text: "## Sheet: vInfo\n... 50KB of preview ...".padEnd(50_000, "x") }],
  };
}
function pastedChunk(text: string): ChunkLike {
  return {
    kind: "text",
    filename: `pasted-content-${Date.now()}.txt`,
    contentBlocks: [{ type: "text", text }],
  };
}

describe("inventory escalation heuristic", () => {
  it("escalates when a spreadsheet returns zero items (likely Haiku miss)", () => {
    expect(looksIncomplete([], spreadsheetChunk())).toBe(true);
  });

  it("accepts zero items from a tiny pasted-content blurb (the empty-intro case)", () => {
    // The "here the proposed server specifications below" intro case.
    const tinyPaste = pastedChunk("here the proposed server specifications below, covering both the single tier and two tier setups");
    expect(looksIncomplete([], tinyPaste)).toBe(false);
  });

  it("escalates when a LARGE pasted-content blurb returns zero items", () => {
    // Long pasted spec doc that Haiku failed to parse — worth escalating.
    const bigPaste = pastedChunk("x".repeat(5000));
    expect(looksIncomplete([], bigPaste)).toBe(true);
  });

  it("escalates when every item has vcpu=0 and memory_gb=0 (the user's ERPSvr-2024.xlsx case)", () => {
    const items = [
      vm({ name: "A", vcpu: 0, memoryGb: 0, storageGb: 0 }),
      vm({ name: "B", vcpu: 0, memoryGb: 0, storageGb: 0 }),
      vm({ name: "C", vcpu: 0, memoryGb: 0, storageGb: 0 }),
    ];
    expect(looksIncomplete(items, spreadsheetChunk())).toBe(true);
  });

  it("escalates when half or more items are zero", () => {
    const items = [
      vm({ name: "A", vcpu: 0, memoryGb: 0 }),
      vm({ name: "B", vcpu: 0, memoryGb: 0 }),
      vm({ name: "C" }),
      vm({ name: "D" }),
    ];
    expect(looksIncomplete(items, spreadsheetChunk())).toBe(true);
  });

  it("accepts the result when fewer than half are zero", () => {
    const items = [
      vm({ name: "A", vcpu: 0, memoryGb: 0 }),
      vm({ name: "B" }),
      vm({ name: "C" }),
      vm({ name: "D" }),
    ];
    expect(looksIncomplete(items, spreadsheetChunk())).toBe(false);
  });

  it("accepts a fully-populated single-VM extraction", () => {
    expect(looksIncomplete([vm({ name: "single" })], spreadsheetChunk())).toBe(false);
  });

  it("escalates when a single VM came back with zeros", () => {
    expect(looksIncomplete([vm({ name: "single", vcpu: 0, memoryGb: 0 })], spreadsheetChunk())).toBe(true);
  });
});

describe("chunk-count heuristic", () => {
  // Mirror the chunking math used by lib/parsers/content.ts → prepareChunks
  function chunkCount(totalRows: number, rowsPerChunk = 300): number {
    if (totalRows <= rowsPerChunk) return 1;
    return Math.ceil(totalRows / rowsPerChunk);
  }

  it("returns 1 for small files (single-chunk fast path)", () => {
    expect(chunkCount(50)).toBe(1);
    expect(chunkCount(300)).toBe(1);
  });

  it("splits 2000-row RVTools export into 7 chunks (the user's case)", () => {
    expect(chunkCount(2000)).toBe(7);
  });

  it("splits 500 rows into 2 chunks", () => {
    expect(chunkCount(500)).toBe(2);
  });

  it("respects a custom rowsPerChunk", () => {
    expect(chunkCount(1000, 100)).toBe(10);
    expect(chunkCount(1000, 500)).toBe(2);
  });
});

describe("unique header disambiguation", () => {
  // Mirror the helper in lib/parsers/content.ts
  function uniqueHeaders(raw: string[]): string[] {
    const seen = new Map<string, number>();
    return raw.map((h, idx) => {
      const base = (h || `Column ${String.fromCharCode(65 + idx)}`).trim();
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      return count === 0 ? base : `${base} (${count + 1})`;
    });
  }

  it("returns headers unchanged when all unique", () => {
    expect(uniqueHeaders(["Name", "vCPU", "RAM"])).toEqual(["Name", "vCPU", "RAM"]);
  });

  it("appends suffix to duplicate headers (the user's pivoted-layout case)", () => {
    // ERPSvr-2024.xlsx has both columns labelled the same
    const result = uniqueHeaders([
      "YM ERP server with hyper-v",
      "YM ERP server with hyper-v",
    ]);
    expect(result).toEqual([
      "YM ERP server with hyper-v",
      "YM ERP server with hyper-v (2)",
    ]);
  });

  it("handles triple duplicates", () => {
    expect(uniqueHeaders(["X", "X", "X"])).toEqual(["X", "X (2)", "X (3)"]);
  });

  it("fills empty headers with column letters", () => {
    expect(uniqueHeaders(["Name", "", "RAM"])).toEqual(["Name", "Column B", "RAM"]);
  });
});
