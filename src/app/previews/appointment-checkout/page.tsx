import { notFound } from "next/navigation";
import { AppointmentCheckoutPreview } from "@/components/appointment-checkout-preview";

export default function AppointmentCheckoutPreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <AppointmentCheckoutPreview />;
}
