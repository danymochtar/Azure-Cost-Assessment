import { NextResponse } from "next/server";
import { classify } from "@/lib/parsers/classifier";

export const runtime = "nodejs";
export const maxDuration = 60;

interface FilePayload {
  name: string;
  data: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { file: FilePayload };
    if (!body?.file?.data) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    const buf = Buffer.from(body.file.data, "base64");
    const profile = await classify(buf, body.file.name);
    return NextResponse.json({ profile });
  } catch (e) {
    const err = e as Error;
    return NextResponse.json({ error: `${err.name}: ${err.message}` }, { status: 500 });
  }
}
