import { AdminReviewBoard } from "@/components/admin-review-board";
import { getOutputRoot, listCaptureRecords } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const records = await listCaptureRecords();

  return <AdminReviewBoard initialRecords={records} outputRoot={getOutputRoot()} />;
}
