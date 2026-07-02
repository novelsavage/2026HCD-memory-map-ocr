import {
  CaptureUiPrototypes,
  type CapturePrototypeId
} from "@/components/capture-ui-prototypes";

const prototypeIds = [
  "single-flow",
  "camera-first",
  "map-first",
  "staff-kiosk",
  "review-dock"
] satisfies CapturePrototypeId[];

export default async function CaptureUiPrototypePage({
  searchParams
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const params = await searchParams;
  const initialPrototypeId = prototypeIds.includes(
    params.variant as CapturePrototypeId
  )
    ? (params.variant as CapturePrototypeId)
    : "single-flow";

  return <CaptureUiPrototypes initialPrototypeId={initialPrototypeId} />;
}
