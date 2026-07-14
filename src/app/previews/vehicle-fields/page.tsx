import { VehicleFieldsPreview } from "@/components/vehicle-fields-preview";
import { notFound } from "next/navigation";

export default function VehicleFieldsPreviewPage() {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }

  return <VehicleFieldsPreview />;
}
