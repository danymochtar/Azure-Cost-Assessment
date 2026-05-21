import { describe, expect, it } from "vitest";
import { parseCsv } from "@/lib/parsers/content";

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
