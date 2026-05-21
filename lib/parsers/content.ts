import type Anthropic from "@anthropic-ai/sdk";

export type FileKind = "spreadsheet" | "pdf" | "image" | "docx" | "text" | "unknown";

const SPREADSHEET_EXTS = new Set([".xlsx", ".xls", ".csv"]);
const PDF_EXTS = new Set([".pdf"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const DOCX_EXTS = new Set([".docx"]);
const TEXT_EXTS = new Set([".txt", ".md", ".json", ".yml", ".yaml", ".log"]);

const IMAGE_MIME: Record<string, "image/png" | "image/jpeg" | "image/gif" | "image/webp"> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export const ALL_SUPPORTED_EXTS = [
  ...SPREADSHEET_EXTS, ...PDF_EXTS, ...IMAGE_EXTS, ...DOCX_EXTS, ...TEXT_EXTS,
].map((e) => e.replace(/^\./, "")).sort();

export const MAX_FILE_MB = 30;

type ContentBlock = Anthropic.Messages.ContentBlockParam;

export interface UploadContent {
  kind: FileKind;
  filename: string;
  contentBlocks: ContentBlock[];
  textSummary: string;
  rowCount: number;
}

function ext(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i).toLowerCase() : "";
}

export function kindFromName(filename: string): FileKind {
  const e = ext(filename);
  if (SPREADSHEET_EXTS.has(e)) return "spreadsheet";
  if (PDF_EXTS.has(e)) return "pdf";
  if (IMAGE_EXTS.has(e)) return "image";
  if (DOCX_EXTS.has(e)) return "docx";
  if (TEXT_EXTS.has(e)) return "text";
  return "unknown";
}

function imageMime(filename: string) {
  return IMAGE_MIME[ext(filename)] ?? "image/png";
}

function toBase64(data: Buffer | Uint8Array): string {
  return Buffer.isBuffer(data) ? data.toString("base64") : Buffer.from(data).toString("base64");
}

async function extractDocxText(data: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer: data });
  return result.value;
}

interface SpreadsheetPreview {
  preview: string;
  rowCount: number;
  sheetNames: string[];
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const splitRow = (s: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < s.length; i += 1) {
      const c = s[i];
      if (inQuotes) {
        if (c === '"' && s[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else if (c === '"') {
          inQuotes = false;
        } else cur += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
    out.push(cur);
    return out;
  };
  const headers = uniqueHeadersLocal(splitRow(lines[0]).map((h) => h.trim()));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitRow(lines[i]);
    const r: Record<string, string> = {};
    for (let j = 0; j < headers.length; j += 1) r[headers[j]] = (cells[j] ?? "").trim();
    rows.push(r);
  }
  return { headers, rows };
}

function uniqueHeadersLocal(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, idx) => {
    const base = (h || `Column ${String.fromCharCode(65 + idx)}`).trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

// Pivoted spreadsheets sometimes use the SAME header text on two
// adjacent columns (e.g. both labelled "YM ERP server with hyper-v",
// where one column holds row labels and the other holds the values).
// Naively keying rows by header name collapses those columns and
// loses one side. Disambiguate by appending an index suffix.
function uniqueHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, idx) => {
    const base = (h || `Column ${String.fromCharCode(65 + idx)}`).trim();
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

async function readWorkbook(data: Buffer, filename: string) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const sheets: { name: string; headers: string[]; rows: Record<string, unknown>[] }[] = [];
  wb.eachSheet((ws) => {
    const allRows: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values as unknown[];
      allRows.push(vals.slice(1));
    });
    if (allRows.length === 0) {
      sheets.push({ name: ws.name, headers: [], rows: [] });
      return;
    }
    const headers = uniqueHeaders(allRows[0].map((h) => String(h ?? "")));
    const rows = allRows.slice(1).map((arr) => {
      const r: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        r[h] = arr[i] ?? "";
      });
      return r;
    });
    sheets.push({ name: ws.name, headers, rows });
  });
  return { sheets };
}

async function buildSpreadsheetPreview(
  data: Buffer,
  filename: string,
  sampleRows: number | null,
): Promise<SpreadsheetPreview> {
  let sheets: { name: string; headers: string[]; rows: Record<string, unknown>[] }[];
  if (filename.toLowerCase().endsWith(".csv")) {
    const text = data.toString("utf-8");
    const { headers, rows } = parseCsv(text);
    sheets = [{ name: "csv", headers, rows: rows as Record<string, unknown>[] }];
  } else {
    sheets = (await readWorkbook(data, filename)).sheets;
  }

  const out: string[] = [`# ${filename}`, `Sheets: ${sheets.map((s) => s.name).join(", ")}`, ""];
  let totalRows = 0;
  for (const s of sheets) {
    totalRows += s.rows.length;
    const sample = sampleRows === null ? s.rows : s.rows.slice(0, sampleRows);
    out.push(`## Sheet: ${s.name} (${s.rows.length.toLocaleString()} rows)`);
    if (s.rows.length === 0) {
      out.push("(empty)");
      continue;
    }
    out.push(`Columns: ${s.headers.join(" | ")}`);
    out.push("Rows:");
    for (const r of sample) {
      out.push(s.headers.map((h) => String(r[h] ?? "")).join(" | "));
    }
    out.push("");
  }
  return { preview: out.join("\n"), rowCount: totalRows, sheetNames: sheets.map((s) => s.name) };
}

export async function prepare(
  data: Buffer,
  filename: string,
  spreadsheetPreviewRows: number | null = null,
): Promise<UploadContent> {
  const sizeMb = data.length / (1024 * 1024);
  if (sizeMb > MAX_FILE_MB) {
    throw new Error(`File too large: ${sizeMb.toFixed(1)} MB (cap ${MAX_FILE_MB} MB).`);
  }
  const kind = kindFromName(filename);
  const uc: UploadContent = {
    kind,
    filename,
    contentBlocks: [],
    textSummary: "",
    rowCount: 0,
  };

  if (kind === "spreadsheet") {
    const sp = await buildSpreadsheetPreview(data, filename, spreadsheetPreviewRows);
    uc.contentBlocks = [{ type: "text", text: sp.preview }];
    uc.rowCount = sp.rowCount;
    uc.textSummary = `Spreadsheet — ${sp.sheetNames.length} sheet(s), ${sp.rowCount.toLocaleString()} rows total`;
    return uc;
  }

  if (kind === "pdf") {
    uc.contentBlocks = [
      {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: toBase64(data) },
      },
    ];
    uc.textSummary = `PDF — ${data.length.toLocaleString()} bytes`;
    return uc;
  }

  if (kind === "image") {
    uc.contentBlocks = [
      {
        type: "image",
        source: { type: "base64", media_type: imageMime(filename), data: toBase64(data) },
      },
    ];
    uc.textSummary = `Image — ${data.length.toLocaleString()} bytes`;
    return uc;
  }

  if (kind === "docx") {
    const text = await extractDocxText(data);
    uc.contentBlocks = [{ type: "text", text: `<docx_content>\n${text}\n</docx_content>` }];
    uc.textSummary = `DOCX — ${text.length.toLocaleString()} chars extracted`;
    return uc;
  }

  if (kind === "text") {
    const text = data.toString("utf-8");
    uc.contentBlocks = [{ type: "text", text: `<file_content>\n${text}\n</file_content>` }];
    uc.textSummary = `Text — ${text.length.toLocaleString()} chars`;
    return uc;
  }

  throw new Error(`Unsupported file type: ${filename}. Supported: ${ALL_SUPPORTED_EXTS.join(", ")}`);
}

/**
 * Token-aware preview chunking for large spreadsheets.
 *
 * Anthropic enforces an organisation-level "input tokens per minute"
 * rate limit (50,000 TPM on Tier 1). A full RVTools export with 2,000+
 * VMs serialised into a single text preview easily exceeds that in
 * one request, returning 429 before the API even runs. Splitting the
 * rows into smaller chunks lets each call stay under the limit; the
 * inventory extractor concatenates the per-chunk results.
 *
 * Returns one UploadContent per chunk. For non-spreadsheet files
 * (PDF / DOCX / image / text) chunking isn't safe, so we return a
 * single-element array containing the unchunked content.
 */
export interface UploadChunk extends UploadContent {
  chunkIndex: number;     // 0-based
  totalChunks: number;
  chunkLabel?: string;    // "rows 1-300 of 2000"
}

export async function prepareChunks(
  data: Buffer,
  filename: string,
  rowsPerChunk = 300,
): Promise<UploadChunk[]> {
  const sizeMb = data.length / (1024 * 1024);
  if (sizeMb > MAX_FILE_MB) {
    throw new Error(`File too large: ${sizeMb.toFixed(1)} MB (cap ${MAX_FILE_MB} MB).`);
  }

  const kind = kindFromName(filename);
  if (kind !== "spreadsheet") {
    const uc = await prepare(data, filename, null);
    return [{ ...uc, chunkIndex: 0, totalChunks: 1 }];
  }

  // Read all sheets once, then decide whether to chunk.
  let sheets: { name: string; headers: string[]; rows: Record<string, unknown>[] }[];
  if (filename.toLowerCase().endsWith(".csv")) {
    const text = data.toString("utf-8");
    const { headers, rows } = parseCsv(text);
    sheets = [{ name: "csv", headers, rows: rows as Record<string, unknown>[] }];
  } else {
    sheets = (await readWorkbook(data, filename)).sheets;
  }

  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);

  // Single-chunk fast path: small files behave exactly like prepare()
  // used to. No batching overhead for the common RVTools-with-50-VMs case.
  if (totalRows <= rowsPerChunk) {
    const uc = await prepare(data, filename, null);
    return [{ ...uc, chunkIndex: 0, totalChunks: 1 }];
  }

  // Flatten (sheet, row) pairs into a single sequence so we can chunk
  // across sheet boundaries cleanly.
  const all: { sheetIdx: number; rowIdx: number }[] = [];
  for (let si = 0; si < sheets.length; si += 1) {
    for (let ri = 0; ri < sheets[si].rows.length; ri += 1) {
      all.push({ sheetIdx: si, rowIdx: ri });
    }
  }

  const chunks: UploadChunk[] = [];
  const totalChunks = Math.ceil(all.length / rowsPerChunk);

  for (let c = 0; c < totalChunks; c += 1) {
    const start = c * rowsPerChunk;
    const end = Math.min(start + rowsPerChunk, all.length);
    const slice = all.slice(start, end);

    // Group the chunk's rows back by their owning sheet so the preview
    // stays readable (one section per sheet within this chunk).
    const bySheet = new Map<number, number[]>();
    for (const { sheetIdx, rowIdx } of slice) {
      if (!bySheet.has(sheetIdx)) bySheet.set(sheetIdx, []);
      bySheet.get(sheetIdx)!.push(rowIdx);
    }

    const out: string[] = [
      `# ${filename}`,
      `Chunk ${c + 1} of ${totalChunks} (rows ${start + 1}–${end} of ${all.length})`,
      `Sheets in this chunk: ${[...bySheet.keys()].map((i) => sheets[i].name).join(", ")}`,
      "",
    ];

    for (const [sheetIdx, rowIdxs] of bySheet.entries()) {
      const s = sheets[sheetIdx];
      out.push(`## Sheet: ${s.name} (${s.rows.length.toLocaleString()} rows total; this chunk: ${rowIdxs.length})`);
      out.push(`Columns: ${s.headers.join(" | ")}`);
      out.push("Rows:");
      for (const ri of rowIdxs) {
        const r = s.rows[ri];
        out.push(s.headers.map((h) => String(r[h] ?? "")).join(" | "));
      }
      out.push("");
    }

    chunks.push({
      kind: "spreadsheet",
      filename,
      contentBlocks: [{ type: "text", text: out.join("\n") }],
      textSummary: `Spreadsheet chunk ${c + 1}/${totalChunks} — rows ${start + 1}–${end} of ${all.length}`,
      rowCount: end - start,
      chunkIndex: c,
      totalChunks,
      chunkLabel: `rows ${start + 1}–${end} of ${all.length}`,
    });
  }

  return chunks;
}
