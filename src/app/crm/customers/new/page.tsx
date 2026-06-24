import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { CustomerForm } from "@/components/customer-form";
import { requireCrmUser } from "@/lib/auth/crm";
import { createCustomerAction } from "../../actions";

export default async function NewCustomerPage() {
  const { user } = await requireCrmUser();

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Customer</h1>
            <p>Add a customer under this business.</p>
          </div>
          <Link href="/crm/customers">Back to customers</Link>
        </div>

        <div className="panel">
          <CustomerForm action={createCustomerAction} />
        </div>
      </section>
    </AppShell>
  );
}
