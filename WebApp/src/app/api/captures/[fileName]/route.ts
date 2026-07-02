import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getOutputRoot } from "@/lib/records";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileName: string }> }
) {
  const { fileName } = await context.params;
  const safeName = path.basename(fileName);
  const filePath = path.join(getOutputRoot(), "captures", safeName);

  try {
    const file = await readFile(filePath);
    return new NextResponse(file, {
      headers: {
        "Content-Type": contentTypeFor(safeName)
      }
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}

function contentTypeFor(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}
