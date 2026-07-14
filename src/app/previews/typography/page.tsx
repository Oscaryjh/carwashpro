import { TypographyPreview } from "@/components/typography-preview";
import { notFound } from "next/navigation";

export default function TypographyPreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <TypographyPreview />;
}
