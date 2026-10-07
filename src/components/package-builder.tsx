"use client";

import { useState } from "react";
import { formatCents, parseMoneyToCents } from "@/lib/commercial/money";
import type {
  Package,
  PackageCategory,
  Service,
  ServiceCategory,
} from "@prisma/client";
import { BranchSelect } from "@/components/branch-select";
import { PackageServiceBenefitsField } from "@/components/package-service-benefits-field";
import { PackageServiceDropdown } from "@/components/package-service-dropdown";
import type { BranchOption } from "@/lib/branches";

export type PackageBuilderProps = {
  action: (formData: FormData) => Promise<void>;
  packagePlan?: Pick<Package, "id" | "name" | "categoryId" | "description" | "branchId" | "serviceId" | "totalUses" | "status"> & { price: string };
  categories?: Pick<PackageCategory, "id" | "name" | "status">[];
  services: Array<
    Pick<Service, "id" | "name" | "category"> & {
      price: string;
      serviceCategory?: Pick<ServiceCategory, "name"> | null;
    }
  >;
  branches?: BranchOption[];
  submitLabel?: string;
  formId?: string;
  isSalonBusiness?: boolean;
  serviceBenefits?: Array<{ serviceId: string; totalUses: number }>;
};

export function PackageBuilder({
  action,
  packagePlan,
  categories = [],
  services,
  branches = [],
  submitLabel,
  formId,
  isSalonBusiness = false,
  serviceBenefits = [],
}: PackageBuilderProps) {
  const isCreate = !packagePlan;
  const [price, setPrice] = useState(packagePlan ? Number(packagePlan.price).toFixed(2) : isSalonBusiness ? "" : "180.00");
  const [benefits, setBenefits] = useState(serviceBenefits);
  const [washServiceId, setWashServiceId] = useState(packagePlan?.serviceId ?? "");
  const [washUses, setWashUses] = useState(packagePlan?.totalUses ?? 10);
  const referenceItems = isSalonBusiness ? benefits : [{ serviceId: washServiceId, totalUses: washUses }];
  let regularCents: number | null = referenceItems.length ? 0 : null;
  for (const item of referenceItems) {
    const service = services.find(candidate => candidate.id === item.serviceId);
    if (!service || !Number.isSafeInteger(item.totalUses) || item.totalUses < 1) { regularCents = null; break; }
    const unitCents = parseMoneyToCents(service.price);
    const next = (regularCents ?? 0) + (unitCents ?? 0) * item.totalUses;
    if (unitCents === null || !Number.isSafeInteger(next)) { regularCents = null; break; }
    regularCents = next;
  }
  let priceCents: number | null = null;
  try { priceCents = parseMoneyToCents(price); } catch { /* Incomplete input is not a price. */ }
  const savings = regularCents !== null && regularCents > 0 && priceCents !== null && priceCents > 0 ? regularCents - priceCents : null;
  const descriptionField = (
    <label>
      <span className={!isCreate ? "package-description-label" : undefined}>Description{!isCreate ? <small>Optional</small> : null}</span>
      <textarea
        name="description"
        rows={3}
        defaultValue={packagePlan?.description ?? (isSalonBusiness ? "" : "Prepaid 10-wash package.")}
        placeholder={isSalonBusiness ? "Describe what is included in this package." : "Describe what is included in this wash package."}
      />
    </label>
  );
  const serviceGroups = Array.from(
    services.reduce((groups, service) => {
      const categoryName =
        service.serviceCategory?.name ?? service.category?.trim() ?? "Other services";
      const categoryServices = groups.get(categoryName) ?? [];
      categoryServices.push(service);
      groups.set(categoryName, categoryServices);
      return groups;
    }, new Map<string, typeof services>()),
  ).sort(([left], [right]) => {
    if (left === "Other services") return 1;
    if (right === "Other services") return -1;
    return left.localeCompare(right);
  });

  return (
    <form action={action} className={`form package-reference-form${isCreate ? " package-create-form" : " package-edit-form"}`} id={formId}>
      {packagePlan ? (
        <input type="hidden" name="packageId" value={packagePlan.id} />
      ) : null}
      {isCreate ? <BranchSelect branches={branches} /> : null}
      <div className="field-grid">
        {!isCreate ? (
          <BranchSelect branches={branches} selectedBranchId={packagePlan?.branchId} />
        ) : null}
        <label>
          <span>Category</span>
          <select name="categoryId" defaultValue={packagePlan?.categoryId ?? ""} required>
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
                {category.status === "INACTIVE" ? " (inactive)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Name</span>
          <input
            name="name"
            defaultValue={
              packagePlan?.name ?? (isSalonBusiness ? "" : "10 Wash Package")
            }
            placeholder={
              isSalonBusiness ? "e.g. Hair Wash 5 Uses" : "e.g. Car Wash 10 Uses"
            }
            required
          />
        </label>
        <label>
          <span>Package price</span>
          <input
            name="price"
            type="number"
            step="0.01"
            min="0.01"
            value={price}
            onChange={event => setPrice(event.target.value)}
            placeholder="0.00"
            required
          />
          {isCreate ? <small>Price in RM</small> : null}
        </label>
        {!isSalonBusiness ? (
          <>
            <label>
              <span>Total Uses</span>
              <input
                name="totalUses"
                type="number"
                min="1"
                step="1"
                value={washUses}
                onChange={event => setWashUses(Number(event.target.value))}
                placeholder="10"
                required
              />
            </label>
            <div className="package-service-field">
              <span>Linked service optional</span>
              <PackageServiceDropdown name="serviceId" value={washServiceId} onChange={setWashServiceId}
                label="Linked service optional" placeholder="Any wash service" groups={serviceGroups} />
            </div>
          </>
        ) : null}
        {packagePlan ? (
          <label>
            <span>Status</span>
            <select name="status" defaultValue={packagePlan.status}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
        ) : null}
      </div>
      {isSalonBusiness ? (
        <PackageServiceBenefitsField
          services={services.map((service) => ({
            id: service.id,
            name: service.name,
            price: service.price,
            categoryName:
              service.serviceCategory?.name ?? service.category?.trim() ?? "Other services",
          }))}
          initialBenefits={serviceBenefits}
          onBenefitsChange={setBenefits}
          createMode={isCreate}
        />
      ) : null}
      <div className="package-price-reference" aria-live="polite">
        <div><span>Regular value</span><strong>{regularCents === null ? "Regular value unavailable" : formatCents(regularCents)}</strong></div>
        {!isCreate ? <div><span>Package price</span><strong>{priceCents === null ? "—" : formatCents(priceCents)}</strong></div> : null}
        {savings !== null && savings >= 0 ? <div><span>Customer saves</span><strong>{formatCents(savings)}</strong></div> : null}
        {savings !== null && savings < 0 ? <p>Package price is {formatCents(-savings)} above regular value.</p> : null}
        <small>Based on current service prices. Reference only; your package price stays unchanged.</small>
      </div>
      {isCreate ? (
        <details className="package-advanced-settings">
          <summary>Advanced settings</summary>
          {descriptionField}
        </details>
      ) : descriptionField}
      {submitLabel ? (
        <div className={`form-actions${isCreate ? " package-create-actions" : ""}`}>
          <button type="submit">{submitLabel}</button>
        </div>
      ) : null}
    </form>
  );
}
