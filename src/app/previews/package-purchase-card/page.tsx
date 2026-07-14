import { PackagePurchaseCardPreview } from "@/components/package-purchase-card-preview";
import { notFound } from "next/navigation";

export default function PackagePurchaseCardPreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <PackagePurchaseCardPreview />;
}
