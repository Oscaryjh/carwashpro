import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { CustomerForm } from "@/components/customer-form";
import { requireBusinessIndustryContext } from "@/lib/industry-context";
import { getActiveBranches } from "@/lib/branches";
import { normalizePlateNumber } from "@/lib/validation/crm";
import { createCustomerAction } from "../../actions";

type NewCustomerPageProps = {
  searchParams: Promise<{
    name?: string;
    notes?: string;
    plate?: string;
    phone?: string;
    whatsappConversationId?: string;
  }>;
};

export default async function NewCustomerPage({
  searchParams,
}: NewCustomerPageProps) {
  const context = await requireBusinessIndustryContext();
  const { user, businessId } = context;
  const isSalonBusiness = context.industry.industryType === "SALON_BEAUTY";
  const { name, notes, phone, plate, whatsappConversationId } = await searchParams;
  const initialVehiclePlate = plate ? normalizePlateNumber(plate) : "";
  const branches = await getActiveBranches(businessId);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Customer</h1>
            <p>
              {isSalonBusiness
                ? "Add a customer profile under this business."
                : "Add the customer and vehicle under this business."}
            </p>
          </div>
          <BackButton fallbackHref="/crm" />
        </div>

        <div className="panel">
          <CustomerForm
            action={createCustomerAction}
            branches={branches}
            initialName={name ?? ""}
            initialNotes={notes ?? ""}
            initialPhone={phone ?? ""}
            initialVehiclePlate={initialVehiclePlate}
            isSalonBusiness={isSalonBusiness}
            whatsappConversationId={whatsappConversationId}
          />
        </div>
      </section>
    </AppShell>
  );
}
