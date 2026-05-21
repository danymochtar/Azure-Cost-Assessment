import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseCsv, prepareChunks } from "@/lib/parsers/content";

async function buildWorkbook(sheets: Array<{ name: string; rows: unknown[][] }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    for (const row of s.rows) ws.addRow(row);
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}

describe("parseCsv — pivoted layouts", () => {
  it("preserves value columns when the header row is narrower than data rows", () => {
    // Mirrors the real-world ERPSvr spec sheet: a single-cell title in
    // row 1, then key/value pairs in rows 2-N. Pre-fix the second column
    // was silently dropped because headers were sized off row 1 alone.
    const csv = [
      "YM ERP server with hyper-v",
      "Processor,Intel Xeon Gold 6234",
      "RAM,256 GB",
      "OS,Windows Server 2019",
      "Disk,4 x 1.9TB SSD",
    ].join("\n");

    const { headers, rows } = parseCsv(csv);

    expect(headers).toHaveLength(2);
    // First column keeps the title; second column gets a synthetic name.
    expect(headers[0]).toBe("YM ERP server with hyper-v");
    expect(headers[1].length).toBeGreaterThan(0);

    expect(rows).toHaveLength(4);
    // Both sides survive — that's the whole point of this fix.
    expect(rows[0][headers[0]]).toBe("Processor");
    expect(rows[0][headers[1]]).toBe("Intel Xeon Gold 6234");
    expect(rows[3][headers[0]]).toBe("Disk");
    expect(rows[3][headers[1]]).toBe("4 x 1.9TB SSD");
  });

  it("handles multiple value columns (one key, N servers)", () => {
    const csv = [
      "Spec,ERP1,ERP2,ERP3",
      "vCPU,16,16,8",
      "RAM,256,256,128",
    ].join("\n");

    const { headers, rows } = parseCsv(csv);

    expect(headers).toEqual(["Spec", "ERP1", "ERP2", "ERP3"]);
    expect(rows[0]).toEqual({ Spec: "vCPU", ERP1: "16", ERP2: "16", ERP3: "8" });
    expect(rows[1]).toEqual({ Spec: "RAM", ERP1: "256", ERP2: "256", ERP3: "128" });
  });

  it("disambiguates duplicate header names so neither column is lost", () => {
    const csv = [
      "Server,Server",
      "vm1,vm2",
    ].join("\n");

    const { headers, rows } = parseCsv(csv);

    expect(headers).toHaveLength(2);
    expect(new Set(headers).size).toBe(2);
    expect(Object.values(rows[0])).toEqual(["vm1", "vm2"]);
  });

  it("drops wholly-blank rows so sparse exports don't pad the preview", () => {
    const csv = [
      "Name,vCPU,RAM",
      "vm1,2,4",
      ",,",
      "   ,  ,  ",
      "vm2,4,8",
    ].join("\n");

    const { rows } = parseCsv(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0].Name).toBe("vm1");
    expect(rows[1].Name).toBe("vm2");
  });
});

describe("prepareChunks — multi-sheet workbooks", () => {
  it("emits one chunk per populated sheet (so the AI sees focused single-table previews)", async () => {
    const wb = await buildWorkbook([
      { name: "SvrSpec",  rows: [["Name", "vCPU", "Memory"], ["erp1", 8, 32], ["erp2", 8, 32]] },
      { name: "Network",  rows: [["Region", "VNet"], ["eastus2", "hub-vnet"]] },
      { name: "Notes",    rows: [["Field", "Value"], ["Author", "Acme"], ["Date", "2024-11"]] },
    ]);
    const chunks = await prepareChunks(wb, "ERPSvr-2024.xlsx", 500);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.chunkLabel)).toEqual([
      "sheet 'SvrSpec'", "sheet 'Network'", "sheet 'Notes'",
    ]);
    // Each chunk's preview should mention only its own sheet.
    for (const c of chunks) {
      const text = c.contentBlocks[0].type === "text" ? c.contentBlocks[0].text : "";
      const sheetMentions = text.match(/## Sheet:/g) ?? [];
      expect(sheetMentions).toHaveLength(1);
    }
  });

  it("skips wholly-empty sheets so they don't waste a Claude call", async () => {
    const wb = await buildWorkbook([
      { name: "SvrSpec", rows: [["Name", "vCPU"], ["vm1", 4]] },
      { name: "Empty",   rows: [] },
    ]);
    const chunks = await prepareChunks(wb, "single.xlsx", 500);
    // Single populated sheet → fast path (1 chunk), not multi-sheet branch.
    expect(chunks).toHaveLength(1);
  });

  it("fills merged-cell values down so server labels survive (ERPSvr-2024 shape)", async () => {
    // Real-world spec sheet: column A holds the server name merged across
    // every spec row of that server. Before the merge-fill, ExcelJS gave
    // null for non-master cells and the model couldn't tell ERP2 rows
    // apart from ERP1 rows.
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("SvrSpec");
    ws.addRow(["YM ERP server with hyper-v"]);
    ws.addRow(["ERP1", "Server Type", "Virtual server"]);
    ws.addRow([null,   "Processor",   "Xeon Gold 6346"]);
    ws.addRow([null,   "RAM",         "384 GB"]);
    ws.addRow(["ERP2", "Server Type", "Virtual server"]);
    ws.addRow([null,   "Processor",   "Xeon Gold 6346"]);
    ws.addRow([null,   "RAM",         "384 GB"]);
    ws.mergeCells("A2:A4");
    ws.mergeCells("A5:A7");
    const buf = Buffer.from(await wb.xlsx.writeBuffer() as ArrayBuffer);

    const chunks = await prepareChunks(buf, "ERPSvr-2024.xlsx", 500);
    expect(chunks).toHaveLength(1);
    const text = chunks[0].contentBlocks[0].type === "text" ? chunks[0].contentBlocks[0].text : "";
    // ERP1 / ERP2 labels must appear on the Processor and RAM rows too,
    // not just on the Server Type row that originally held the merge master.
    const erp1Lines = text.split("\n").filter((l) => l.includes("ERP1"));
    const erp2Lines = text.split("\n").filter((l) => l.includes("ERP2"));
    expect(erp1Lines.length).toBeGreaterThanOrEqual(3); // Server Type + Processor + RAM
    expect(erp2Lines.length).toBeGreaterThanOrEqual(3);
  });

  it("splits a single large sheet into row-sliced chunks", async () => {
    const headerRow: unknown[] = ["Name", "vCPU"];
    const dataRows: unknown[][] = Array.from({ length: 1200 }, (_, i) => [`vm${i + 1}`, 2]);
    const wb = await buildWorkbook([{ name: "Big", rows: [headerRow, ...dataRows] }]);
    const chunks = await prepareChunks(wb, "big.xlsx", 500);
    expect(chunks).toHaveLength(3);
    // Existing cross-sheet path uses en-dash separators ("rows 1–500 of 1200");
    // tolerate either form so a future format tweak doesn't break the test.
    for (const c of chunks) {
      expect(c.chunkLabel).toMatch(/rows \d+[–-]\d+/);
    }
  });
});
