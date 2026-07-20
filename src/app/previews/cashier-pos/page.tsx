import { CashierPosPreview } from "@/components/cashier-pos-preview";
import { notFound } from "next/navigation";

export default function CashierPosPreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <CashierPosPreview />;
}
