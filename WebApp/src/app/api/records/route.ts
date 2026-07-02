import { NextResponse } from "next/server";
import { getOutputRoot, listCaptureRecords } from "@/lib/records";

export async function GET() {
  const records = await listCaptureRecords();
  return NextResponse.json({
    outputRoot: getOutputRoot(),
    count: records.length,
    records
  });
}
