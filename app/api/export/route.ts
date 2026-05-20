import { NextResponse } from "next/server";
import type { BomLine } from "@/lib/models";
import { buildExcelBom } from "@/lib/output/excel";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      format: "xlsx";
      lines: BomLine[];
      region: string;
      appName: string;
    };
    const safeApp = (body.appName || "assessment").replace(/\s+/g, "-");
    const filename = `azure-${safeApp}-${body.region}.xlsx`;
    const buf = await buildExcelBom(body.lines ?? [], body.region, "USD", body.appName ?? "", []);
    return NextResponse.json({
      data: buf.toString("base64"),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename,
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
