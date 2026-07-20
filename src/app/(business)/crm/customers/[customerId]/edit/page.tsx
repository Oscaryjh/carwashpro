import Link from "next/link";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { VehicleSelectFields } from "@/components/vehicle-select-fields";
import { requireBusinessIndustryContext } from "@/lib/industry-context";
import { getActiveBranches, type BranchOption } from "@/lib/branches";
import { prisma } from "@/lib/prisma";
import { updateCustomerProfileAction } from "../../../actions";

type EditCustomerPageProps = {
  params: Promise<{
    customerId: string;
  }>;
};

export default async function EditCustomerPage({
  params,
}: EditCustomerPageProps) {
  const context = await requireBusinessIndustryContext();
  const { businessId } = context;
  const isSalonBusiness = context.industry.industryType === "SALON_BEAUTY";
  const { customerId } = await params;

  const [customer, branches] = await Promise.all([
    prisma.customer.findFirst({
      where: {
        id: customerId,
        businessId,
      },
      include: {
        vehicles: {
          include: {
            branch: true,
          },
          orderBy: { createdAt: "desc" },
        },
      },
    }),
    getActiveBranches(businessId),
  ]);

  if (!customer) {
    notFound();
  }

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Edit Customer Profile</h1>
            <p>
              {isSalonBusiness
                ? "Update customer contact details, preferences, and treatment notes in one place."
                : "Update customer contact details and linked vehicles in one place."}
            </p>
          </div>
          <div className="inline-actions">
            <BackButton fallbackHref={`/crm/customers/${customer.id}`} />
          </div>
        </div>

        <form action={updateCustomerProfileAction} className="form">
          <input type="hidden" name="customerId" value={customer.id} />

          <div className="panel">
            <div className="section-header">
              <h2>Customer details</h2>
            </div>
            <div className="field-grid">
              <BranchField
                branches={branches}
                name="customerBranchId"
                selectedBranchId={customer.branchId}
              />
              <label>
                <span>Name</span>
                <input name="name" defaultValue={customer.name} required />
              </label>
              <label>
                <span>Phone</span>
                <input name="phone" defaultValue={customer.phone} required />
              </label>
              <label>
                <span>Email optional</span>
                <input name="email" type="email" defaultValue={customer.email ?? ""} />
              </label>
              <label>
                <span>Date of birth optional</span>
                <input
                  name="dateOfBirth"
                  type="date"
                  defaultValue={customer.dateOfBirth?.toISOString().slice(0, 10) ?? ""}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </label>
            </div>
            <label>
              <span>Notes optional</span>
              <textarea name="notes" rows={3} defaultValue={customer.notes ?? ""} />
            </label>
            <div className="field-grid">
              <label>
                <span>Preferences optional</span>
                <textarea
                  name="preferences"
                  rows={3}
                  defaultValue={customer.preferences ?? ""}
                  placeholder="Preferred stylist, products, or service notes"
                />
              </label>
              <label>
                <span>Treatment notes optional</span>
                <textarea
                  name="treatmentNotes"
                  rows={3}
                  defaultValue={customer.treatmentNotes ?? ""}
                  placeholder="Colour formula, treatment history, or sensitivities"
                />
              </label>
            </div>
          </div>

          {!isSalonBusiness ? <div className="panel">
            <div className="section-header">
              <h2>Vehicles</h2>
              <Link
                className="button-link"
                href={`/crm/vehicles/new?customerId=${customer.id}`}
              >
                Add Vehicle
              </Link>
            </div>

            {customer.vehicles.length ? (
              <div className="service-list">
                {customer.vehicles.map((vehicle) => (
                  <div className="inline-editor" key={vehicle.id}>
                    <h3>{vehicle.plateNumber}</h3>
                    <input type="hidden" name="vehicleId" value={vehicle.id} />
                    <div className="field-grid">
                      <BranchField
                        branches={branches}
                        name="vehicleBranchId"
                        selectedBranchId={vehicle.branchId}
                      />
                      <label>
                        <span>Plate number</span>
                        <input
                          name="vehiclePlateNumber"
                          defaultValue={vehicle.plateNumber}
                          required
                        />
                      </label>
                      <VehicleSelectFields
                        brandName="vehicleBrand"
                        colorName="vehicleColor"
                        defaultBrand={vehicle.brand}
                        defaultColor={vehicle.color}
                        defaultModel={vehicle.model}
                        modelName="vehicleModel"
                      />
                    </div>
                    <label>
                      <span>Notes optional</span>
                      <textarea
                        name="vehicleNotes"
                        rows={3}
                        defaultValue={vehicle.notes ?? ""}
                      />
                    </label>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                No vehicles yet. Add the first vehicle for this customer.
              </p>
            )}
          </div> : null}

          <div className="form-actions">
            <button type="submit">Save</button>
          </div>
        </form>
      </section>
    </>
  );
}

function BranchField({
  branches,
  name,
  selectedBranchId,
}: {
  branches: BranchOption[];
  name: string;
  selectedBranchId?: string | null;
}) {
  if (!branches.length) {
    return null;
  }

  if (branches.length === 1) {
    return <input type="hidden" name={name} value={branches[0].id} />;
  }

  return (
    <label>
      <span>Branch</span>
      <select name={name} defaultValue={selectedBranchId ?? ""} required>
        <option value="" disabled>
          Select branch
        </option>
        {branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
    </label>
  );
}
