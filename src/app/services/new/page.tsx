import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ServiceForm } from "@/components/service-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { createServiceAction } from "../actions";

export default async function NewServicePage() {
  const { user } = await requireBusinessUser();

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Service</h1>
            <p>Add a service item for work orders.</p>
          </div>
          <Link href="/services">Back to services</Link>
        </div>

        <div className="panel">
          <ServiceForm action={createServiceAction} submitLabel="Create service" />
        </div>
      </section>
    </AppShell>
  );
}
