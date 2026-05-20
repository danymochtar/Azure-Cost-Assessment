import { NextResponse } from "next/server";
import { z } from "zod";
import { buildExcelBom } from "@/lib/output/excel";

export const runtime = "nodejs";
export const maxDuration = 30;

const BomLineSchema = z.object({
  category: z.string(),
  resource: z.string(),
  sku: z.string(),
  meter: z.string(),
  region: z.string(),
  quantity: z.number(),
  unit: z.string(),
  unitPrice: z.number(),
  monthlyCost: z.number(),
  currency: z.string(),
  source: z.string(),
  productId: z.string(),
  skuId: z.string(),
  meterId: z.string(),
  serviceName: z.string(),
  customName: z.string(),
  resourceCount: z.number().int(),
  billingTerm: z.string(),
  assumption: z.string(),
});

const BodySchema = z.object({
  format: z.literal("xlsx"),
  lines: z.array(BomLineSchema),
  region: z.string(),
  appName: z.string().default(""),
  globalAssumptions: z.array(z.string()).default([]),
});

export async function POST(req: Request) {
  try {
    const body = BodySchema.parse(await req.json());
    const safeApp = (body.appName || "assessment").replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-_]/g, "");
    const filename = `azure-${safeApp || "assessment"}-${body.region}.xlsx`;
    const buf = await buildExcelBom(
      body.lines,
      body.region,
      "USD",
      body.appName,
      body.globalAssumptions,
    );
    return NextResponse.json({
      data: buf.toString("base64"),
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid request body", details: e.issues }, { status: 400 });
    }
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
