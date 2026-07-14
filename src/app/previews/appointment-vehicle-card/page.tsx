import { AppointmentVehicleCardPreview } from "@/components/appointment-vehicle-card-preview";
import { notFound } from "next/navigation";

export default function AppointmentVehicleCardPreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <AppointmentVehicleCardPreview />;
}
