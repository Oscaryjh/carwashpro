import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CustomerForm } from "@/components/customer-form";
import { requireCrmUser } from "@/lib/auth/crm";
import { getActiveBranches } from "@/lib/branches";
import { normalizePlateNumber } from "@/lib/validation/crm";
import { createCustomerAction } from "../../actions";

type NewCustomerPageProps = {
  searchParams: Promise<{
    plate?: string;
  }>;
};

export default async function NewCustomerPage({
  searchParams,
}: NewCustomerPageProps) {
  const { user, businessId } = await requireCrmUser();
  const { plate } = await searchParams;
  const initialVehiclePlate = plate ? normalizePlateNumber(plate) : "";
  const branches = await getActiveBranches(businessId);

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Customer</h1>
            <p>Add the customer and vehicle under this business.</p>
          </div>
          <Link className="secondary-link-button" href="/crm">
            Back to CRM
          </Link>
        </div>

        <div className="panel">
          <CustomerForm
            action={createCustomerAction}
            branches={branches}
            initialVehiclePlate={initialVehiclePlate}
          />
        </div>
      </section>
    </AppShell>
  );
}
