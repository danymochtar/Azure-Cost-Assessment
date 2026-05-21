import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Read the source file directly so we test the actual prompt that
// ships, not a re-export. Keeps the "reasoning" instruction from
// silently regressing across refactors.
const CLASSIFIER_SOURCE = readFileSync(
  resolve(__dirname, "../lib/parsers/classifier.ts"),
  "utf-8",
);
const INVENTORY_SOURCE = readFileSync(
  resolve(__dirname, "../lib/parsers/inventory.ts"),
  "utf-8",
);

describe("Classifier prompt — reasoning contract", () => {
  it("requires a 'reasoning' field in the tool schema and prompt rules", () => {
    expect(CLASSIFIER_SOURCE).toMatch(/reasoning:\s*z\.string\(\)/);
    expect(CLASSIFIER_SOURCE).toMatch(/reasoning\s*[—:]\s*1[–-]2 sentences/);
  });

  it("the prompt mentions defending the pillar choice to a stakeholder", () => {
    expect(CLASSIFIER_SOURCE).toMatch(/customer architect could defend|architect could defend/i);
  });

  it("the AssessmentProfile aggregation surfaces a fallback reasoning when nothing classifies", () => {
    expect(CLASSIFIER_SOURCE).toMatch(/reasoning:\s*["'`]No file/);
  });
});

describe("Extractor prompt — sizing + service rationale contract", () => {
  it("requires sizing_rationale and service_rationale fields in the tool schema", () => {
    expect(INVENTORY_SOURCE).toMatch(/sizing_rationale:\s*z\.string\(\)/);
    expect(INVENTORY_SOURCE).toMatch(/service_rationale:\s*z\.string\(\)/);
  });

  it("the prompt teaches the family heuristic (D/E/B/F/NC) so the model can defend its SKU pick", () => {
    expect(INVENTORY_SOURCE).toMatch(/general-purpose/i);
    expect(INVENTORY_SOURCE).toMatch(/memory-optimised|memory-optimized/i);
    expect(INVENTORY_SOURCE).toMatch(/burstable/i);
  });

  it("mapItems copies the rationale fields through to InventoryItem", () => {
    expect(INVENTORY_SOURCE).toMatch(/sizingRationale:\s*i\.sizing_rationale/);
    expect(INVENTORY_SOURCE).toMatch(/serviceRationale:\s*i\.service_rationale/);
  });
});
