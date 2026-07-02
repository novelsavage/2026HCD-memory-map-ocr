import { AdminReviewPrototype } from "@/components/admin-review-prototype";
import { getOutputRoot, listCaptureRecords } from "@/lib/records";

export const dynamic = "force-dynamic";

export default async function ReviewPrototypePage() {
  const records = await listCaptureRecords();

  return (
    <AdminReviewPrototype initialRecords={records} outputRoot={getOutputRoot()} />
  );
}
