import { NextResponse } from "next/server";
import { classifyMany, type FileBlob } from "@/lib/parsers/classifier";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const blobs: FileBlob[] = [];
    for (const [, value] of form.entries()) {
      if (value instanceof Blob) {
        const name = "name" in value && typeof value.name === "string" ? value.name : "upload";
        const buf = Buffer.from(await value.arrayBuffer());
        blobs.push({ name, data: buf });
      }
    }
    if (blobs.length === 0) {
      return NextResponse.json({ error: "No files in form" }, { status: 400 });
    }

    const { perFile, aggregate } = await classifyMany(blobs);
    return NextResponse.json({
      perFile: perFile.map((p) => ({
        filename: p.filename,
        profile: p.profile,
        error: p.error,
      })),
      profile: aggregate,
    });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
