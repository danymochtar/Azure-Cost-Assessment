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

/** Max edge (pixels) for images sent to the vision model. Beyond this
 *  point the model's OCR doesn't gain much, but vision input tokens
 *  (and latency) keep growing linearly with pixel count. */
const IMAGE_MAX_EDGE_PX = 1600;
/** JPEG quality for re-encoded screenshots. 85 keeps text legible at
 *  ~6-10× smaller payload than the source PNG for typical UI shots. */
const IMAGE_JPEG_QUALITY = 85;

async function optimizeImage(
  data: Buffer,
  filename: string,
): Promise<{ data: Buffer; mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"; beforeBytes: number; afterBytes: number; resized: boolean }> {
  const beforeBytes = data.length;
  // Animated GIFs lose their animation when run through sharp; skip
  // optimization entirely for that format.
  if (filename.toLowerCase().endsWith(".gif")) {
    return { data, mediaType: imageMime(filename), beforeBytes, afterBytes: beforeBytes, resized: false };
  }
  try {
    const sharp = (await import("sharp")).default;
    const img = sharp(data, { failOn: "none" });
    const meta = await img.metadata();
    const maxEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
    const needsResize = maxEdge > IMAGE_MAX_EDGE_PX;
    // Re-encode to JPEG when the source is larger than 200 KB (typical
    // for screenshots); leaves small images untouched.
    const needsRecode = beforeBytes > 200_000;
    if (!needsResize && !needsRecode) {
      return { data, mediaType: imageMime(filename), beforeBytes, afterBytes: beforeBytes, resized: false };
    }
    let pipeline = img;
    if (needsResize) {
      pipeline = pipeline.resize({ width: IMAGE_MAX_EDGE_PX, height: IMAGE_MAX_EDGE_PX, fit: "inside", withoutEnlargement: true });
    }
    const out = await pipeline.jpeg({ quality: IMAGE_JPEG_QUALITY, mozjpeg: true }).toBuffer();
    return { data: out, mediaType: "image/jpeg", beforeBytes, afterBytes: out.length, resized: needsResize };
  } catch {
    // Sharp can fail on exotic formats / corrupted headers — fall
    // back to sending the original bytes so the user still gets a
    // result, just slower.
    return { data, mediaType: imageMime(filename), beforeBytes, afterBytes: beforeBytes, resized: false };
  }
}

interface SpreadsheetPreview {
  preview: string;
  rowCount: number;
  sheetNames: string[];
}

export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
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
  // Same pivoted-layout defence as the workbook reader: size headers off
  // the widest row, not just the first line, so value columns past a
  // shorter title row survive the preview.
  const splitRows = lines.map(splitRow);
  const maxCols = splitRows.reduce((m, r) => Math.max(m, r.length), 0);
  const rawHeader = [...splitRows[0]];
  while (rawHeader.length < maxCols) rawHeader.push("");
  const headers = uniqueHeadersLocal(rawHeader.map((h) => h.trim()));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < splitRows.length; i += 1) {
    const cells = splitRows[i];
    // Skip rows where every cell is blank — keeps the preview compact
    // and stops sparse spreadsheets blowing the chunk budget.
    if (cells.every((c) => !c || !String(c).trim())) continue;
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
    // Pivoted spec sheets often have a single-cell title row above the
    // key/value pairs (e.g. "YM ERP server with hyper-v" alone in row 1,
    // then "Processor | Xeon Gold 6234" in row 2, "RAM | 256 GB" in row 3
    // and so on). Sizing headers off allRows[0] alone would drop every
    // value-side cell beyond the header's width. Take the widest row
    // instead so no column is silently truncated.
    const maxCols = allRows.reduce((m, r) => Math.max(m, r.length), 0);
    const rawHeaderRow: unknown[] = [...allRows[0]];
    while (rawHeaderRow.length < maxCols) rawHeaderRow.push("");
    const headers = uniqueHeaders(rawHeaderRow.map((h) => String(h ?? "")));
    const rows: Record<string, unknown>[] = [];
    for (const arr of allRows.slice(1)) {
      // Drop wholly-empty rows so a sparse RVTools export doesn't
      // pad the preview / inflate the chunk count.
      if (arr.every((v) => v == null || String(v).trim() === "")) continue;
      const r: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        r[h] = arr[i] ?? "";
      });
      rows.push(r);
    }
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
    // Downscale anything bigger than 1600px on the longest edge before
    // sending to Claude — vision input tokens scale with pixel count,
    // and a 4k screenshot is ~5× the tokens (and latency) of a 1600px
    // version of the same content. JPEG re-encode at q=85 also halves
    // the wire payload for PNG screenshots.
    const { data: optimized, mediaType, beforeBytes, afterBytes, resized } =
      await optimizeImage(data, filename);
    uc.contentBlocks = [
      {
        type: "image",
        source: { type: "base64", media_type: mediaType, data: toBase64(optimized) },
      },
    ];
    uc.textSummary = resized
      ? `Image — downscaled ${beforeBytes.toLocaleString()} → ${afterBytes.toLocaleString()} bytes`
      : `Image — ${beforeBytes.toLocaleString()} bytes`;
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

/** Render a single sheet (or a row-slice of a sheet) as a Claude-
 *  friendly text preview. Pulled out so the multi-sheet and the
 *  cross-sheet chunking paths share the same formatting. */
function renderSheetPreview(
  filename: string,
  sheet: { name: string; headers: string[]; rows: Record<string, unknown>[] },
  rowIdxs: number[],
  contextNote: string,
): string {
  const out: string[] = [
    `# ${filename}`,
    `## Sheet: ${sheet.name} (${sheet.rows.length.toLocaleString()} rows total; this chunk: ${rowIdxs.length})`,
    contextNote,
    `Columns: ${sheet.headers.join(" | ")}`,
    "Rows:",
  ];
  for (const ri of rowIdxs) {
    const r = sheet.rows[ri];
    out.push(sheet.headers.map((h) => String(r[h] ?? "")).join(" | "));
  }
  return out.join("\n");
}

/** Emit one chunk per sheet — and split sheets larger than rowsPerChunk
 *  into multiple row-sliced chunks. Used whenever the workbook has >1
 *  populated sheet, so the model never sees a multi-sheet mash-up. */
function perSheetChunks(
  filename: string,
  sheets: { name: string; headers: string[]; rows: Record<string, unknown>[] }[],
  rowsPerChunk: number,
): UploadChunk[] {
  // First pass: build per-sheet slices so we know the total chunk count
  // before emitting any (need totalChunks for the chunk metadata).
  const plan: Array<{ sheetIdx: number; rowIdxs: number[]; label: string }> = [];
  for (let si = 0; si < sheets.length; si += 1) {
    const sheet = sheets[si];
    if (sheet.rows.length <= rowsPerChunk) {
      plan.push({
        sheetIdx: si,
        rowIdxs: sheet.rows.map((_, i) => i),
        label: `sheet '${sheet.name}'`,
      });
    } else {
      // Big sheet: row-slice it. RVTools vInfo with 2,000 hosts lands here.
      for (let start = 0; start < sheet.rows.length; start += rowsPerChunk) {
        const end = Math.min(start + rowsPerChunk, sheet.rows.length);
        plan.push({
          sheetIdx: si,
          rowIdxs: Array.from({ length: end - start }, (_, i) => start + i),
          label: `sheet '${sheet.name}' rows ${start + 1}-${end}`,
        });
      }
    }
  }

  const total = plan.length;
  return plan.map((p, ci) => {
    const sheet = sheets[p.sheetIdx];
    const text = renderSheetPreview(
      filename,
      sheet,
      p.rowIdxs,
      `Workbook has ${sheets.length} populated sheet(s); this chunk is ${p.label} (chunk ${ci + 1} of ${total}).`,
    );
    return {
      kind: "spreadsheet",
      filename,
      contentBlocks: [{ type: "text", text }],
      textSummary: `Spreadsheet chunk ${ci + 1}/${total} — ${p.label}`,
      rowCount: p.rowIdxs.length,
      chunkIndex: ci,
      totalChunks: total,
      chunkLabel: p.label,
    };
  });
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

  // Drop sheets with zero rows (Notes / Cover / empty templates) so they
  // don't waste a Claude call returning "no items here."
  const nonEmptySheets = sheets.filter((s) => s.rows.length > 0);
  const totalRows = nonEmptySheets.reduce((sum, s) => sum + s.rows.length, 0);

  // Multi-sheet workbooks: emit ONE chunk per sheet so the model sees
  // a focused single-table preview rather than a mash-up where it
  // can't tell which sheet to extract from. A workbook with a SvrSpec
  // sheet + a Notes sheet + a Network sheet used to come back with
  // zero items because the AI fixated on the wrong one. Per-sheet
  // chunking gives each sheet its own pass with full headers + rows.
  if (nonEmptySheets.length > 1) {
    return perSheetChunks(filename, nonEmptySheets, rowsPerChunk);
  }

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
