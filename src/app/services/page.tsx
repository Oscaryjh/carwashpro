import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { ServiceForm } from "@/components/service-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { deactivateServiceAction, updateServiceAction } from "./actions";

export default async function ServicesPage() {
  const { user, businessId } = await requireBusinessUser();
  const services = await prisma.service.findMany({
    where: { businessId },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Services</h1>
            <p>Service menu for this business.</p>
          </div>
          <Link className="button-link" href="/services/new">
            New Service
          </Link>
        </div>

        <div className="panel">
          {services.length ? (
            <div className="service-list">
              {services.map((service) => (
                <section className="inline-editor" key={service.id}>
                  <div className="section-header">
                    <div>
                      <h2>{service.name}</h2>
                      <span className={`status ${service.status.toLowerCase()}`}>
                        {service.status}
                      </span>
                    </div>
                    <strong>{Number(service.price).toFixed(2)}</strong>
                  </div>
                  <ServiceForm
                    action={updateServiceAction}
                    service={service}
                    submitLabel="Save service"
                  />
                  {service.status === "ACTIVE" ? (
                    <form action={deactivateServiceAction} className="form-actions">
                      <input type="hidden" name="serviceId" value={service.id} />
                      <button className="secondary-light-button" type="submit">
                        Deactivate
                      </button>
                    </form>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <p className="empty-state">No services yet.</p>
          )}
        </div>
      </section>
    </AppShell>
  );
}
