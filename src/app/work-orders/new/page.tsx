import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BackButton } from "@/components/back-button";
import { BranchSelect } from "@/components/branch-select";
import { UppercaseInput } from "@/components/uppercase-input";
import { VehicleSelectFields } from "@/components/vehicle-select-fields";
import { WorkOrderForm } from "@/components/work-order-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { getOperationalBranches } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { normalizePlateNumber } from "@/lib/validation/crm";
import {
  createVehicleForWorkOrderAction,
  createWorkOrderAction,
} from "../actions";

function isNumericPhone(value: string) {
  return /^[0-9]{7,20}$/.test(value);
}

type NewWorkOrderPageProps = {
  searchParams: Promise<{
    plate?: string;
    customer?: string;
    error?: string;
  }>;
};

export default async function NewWorkOrderPage({
  searchParams,
}: NewWorkOrderPageProps) {
  const { user, businessId } = await requireBusinessUser();
  const { plate, customer, error } = await searchParams;
  const normalizedPlate = plate ? normalizePlateNumber(plate) : "";
  const customerQuery = (customer ?? "").trim();
  const customerQueryIsValid = !customerQuery || isNumericPhone(customerQuery);
  const errorMessage = (error ?? "").trim();
  const staffBranchId =
    user.role === "BUSINESS_OWNER"
      ? null
      : user.branchId ?? "00000000-0000-0000-0000-000000000000";

  const vehicle = normalizedPlate
    ? await prisma.vehicle.findFirst({
        where: {
          businessId,
          ...(staffBranchId ? { branchId: staffBranchId } : {}),
          plateNumber: normalizedPlate,
        },
        include: {
          customer: true,
        },
      })
    : null;

  const [services, branches, matchingCustomers] = await Promise.all([
    prisma.service.findMany({
      where: {
        businessId,
        status: "ACTIVE",
      },
      include: {
        serviceCategory: true,
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    getOperationalBranches(businessId, user),
    normalizedPlate && !vehicle && customerQuery && customerQueryIsValid
      ? prisma.customer.findMany({
          where: {
            businessId,
            phone: {
              contains: customerQuery,
              mode: "insensitive",
            },
          },
          include: {
            vehicles: {
              orderBy: { createdAt: "desc" },
              take: 3,
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
  ]);
  const serviceOptions = services.map((service) => ({
    id: service.id,
    category: service.serviceCategory?.name ?? service.category,
    name: service.name,
    price: Number(service.price),
  }));
  const workOrderVehicle = vehicle
    ? {
        id: vehicle.id,
        branchId: vehicle.branchId,
        plateNumber: vehicle.plateNumber,
        brand: vehicle.brand,
        model: vehicle.model,
        color: vehicle.color,
        customer: {
          name: vehicle.customer.name,
          phone: vehicle.customer.phone,
        },
      }
    : null;

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>New Job</h1>
          </div>
          <BackButton fallbackHref="/work-orders" />
        </div>

        {errorMessage ? <p className="error">{errorMessage}</p> : null}

        {!normalizedPlate || workOrderVehicle ? (
          <div className="panel job-entry-panel">
            <div>
              <h2>Vehicle</h2>
              <p className="muted">Enter plate number to start a job.</p>
            </div>
            <form className="search-form job-plate-search-form" action="/work-orders/new">
              <UppercaseInput
                name="plate"
                placeholder="Enter plate number"
                defaultValue={normalizedPlate}
                autoCapitalize="characters"
                autoComplete="off"
              />
              <button type="submit">Search</button>
            </form>
          </div>
        ) : null}

        {normalizedPlate ? (
          workOrderVehicle ? (
            serviceOptions.length ? (
              <WorkOrderForm
                action={createWorkOrderAction}
                vehicle={workOrderVehicle}
                services={serviceOptions}
                branches={branches}
              />
            ) : (
              <div className="panel">
                <p className="empty-state">Create an active service first.</p>
                <Link className="button-link" href="/services/new">
                  New Service
                </Link>
              </div>
            )
          ) : (
            <MissingVehiclePanel
              plateNumber={normalizedPlate}
              customerQuery={customerQuery}
              customerQueryIsValid={customerQueryIsValid}
              matchingCustomers={matchingCustomers}
              branches={branches}
            />
          )
        ) : null}
      </section>
    </AppShell>
  );
}

type MissingVehiclePanelProps = {
  plateNumber: string;
  customerQuery: string;
  customerQueryIsValid: boolean;
  matchingCustomers: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    vehicles: {
      plateNumber: string;
    }[];
  }[];
  branches: Awaited<ReturnType<typeof getOperationalBranches>>;
};

function MissingVehiclePanel({
  plateNumber,
  customerQuery,
  customerQueryIsValid,
  matchingCustomers,
  branches,
}: MissingVehiclePanelProps) {
  return (
    <div className="panel missing-vehicle-panel">
      <div className="missing-vehicle-top-row">
        <section className="subsection missing-vehicle-card missing-find-vehicle-card">
          <h3>Vehicle</h3>
          <form className="search-form job-plate-search-form" action="/work-orders/new">
            <UppercaseInput
              name="plate"
              placeholder="Enter plate number"
              defaultValue={plateNumber}
              autoCapitalize="characters"
              autoComplete="off"
            />
            <button type="submit">Search</button>
          </form>
        </section>

        <div className="missing-vehicle-status-card">
          <span className="muted">Plate number</span>
          <strong>{plateNumber}</strong>
          <span className="status warning">not found</span>
        </div>

        <section className="subsection missing-vehicle-card missing-owner-search-card">
          <h3>Owner</h3>
          <form className="search-form" action="/work-orders/new">
            <input type="hidden" name="plate" value={plateNumber} />
            <input
              name="customer"
              type="tel"
              inputMode="numeric"
              pattern="[0-9]{7,20}"
              title="Phone number can only contain numbers."
              placeholder="Customer phone number"
              defaultValue={customerQuery}
            />
            <button type="submit">Search</button>
          </form>

          {customerQuery ? (
            !customerQueryIsValid ? (
              <p className="error">Phone number can only contain numbers.</p>
            ) : matchingCustomers.length ? (
              <form action={createVehicleForWorkOrderAction} className="form">
                <input type="hidden" name="mode" value="existing" />
                <input type="hidden" name="plateNumber" value={plateNumber} />
                <input type="hidden" name="customerId" value={matchingCustomers[0].id} />
                <div className="result-box owner-confirm-card">
                  <span className="muted">Phone is registered to</span>
                  <strong>{matchingCustomers[0].name}</strong>
                  <span>
                    {matchingCustomers[0].phone}
                    {matchingCustomers[0].email ? ` - ${matchingCustomers[0].email}` : ""}
                  </span>
                  <span className="muted">
                    {matchingCustomers[0].vehicles.length
                      ? `Existing vehicles: ${matchingCustomers[0].vehicles
                          .map((vehicle) => vehicle.plateNumber)
                          .join(", ")}`
                      : "No vehicles yet"}
                  </span>
                </div>
                <p className="muted">
                  If this is the vehicle owner, add {plateNumber} under this profile.
                </p>
                <div className="field-grid">
                  <BranchSelect branches={branches} />
                  <VehicleFields />
                </div>
                <div className="form-actions">
                  <button type="submit">Add vehicle and continue</button>
                </div>
              </form>
            ) : (
              <p className="empty-state">No customer found for this phone.</p>
            )
          ) : null}
        </section>
      </div>

      {customerQuery && customerQueryIsValid && !matchingCustomers.length ? (
        <section className="subsection missing-vehicle-card missing-register-card">
          <h3>New customer</h3>
          <form action={createVehicleForWorkOrderAction} className="form">
            <input type="hidden" name="mode" value="new" />
            <input type="hidden" name="plateNumber" value={plateNumber} />
            <div className="field-grid">
              <BranchSelect branches={branches} />
              <label>
                <span>Customer name</span>
                <input name="customerName" required />
              </label>
              <label>
                <span>Phone</span>
                <input
                  name="customerPhone"
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]{7,20}"
                  title="Phone number can only contain numbers."
                  defaultValue={customerQuery}
                  required
                />
              </label>
              <label>
                <span>Email optional</span>
                <input name="customerEmail" type="email" />
              </label>
              <VehicleFields />
            </div>
            <label>
              <span>Customer notes optional</span>
              <textarea name="customerNotes" rows={2} />
            </label>
            <div className="form-actions">
              <button type="submit">Add New Customer</button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}

function VehicleFields() {
  return <VehicleSelectFields />;
}
