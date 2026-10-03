import type { Package, Service, ServiceCategory } from "@prisma/client";
import { PackageBuilder, type PackageBuilderProps } from "@/components/package-builder";

type PackageFormProps = Omit<PackageBuilderProps, "packagePlan" | "services"> & {
  packagePlan?: Package;
  services: Array<Pick<Service, "id" | "name" | "category" | "price"> & {
    serviceCategory?: Pick<ServiceCategory, "name"> | null;
  }>;
};

// Serialize only the existing builder's read-model fields across the client boundary.
export function PackageForm({ packagePlan, services, ...props }: PackageFormProps) {
  return <PackageBuilder {...props}
    packagePlan={packagePlan ? {
      id: packagePlan.id, name: packagePlan.name, categoryId: packagePlan.categoryId,
      description: packagePlan.description, branchId: packagePlan.branchId,
      serviceId: packagePlan.serviceId, totalUses: packagePlan.totalUses,
      status: packagePlan.status, price: packagePlan.price.toString(),
    } : undefined}
    services={services.map(service => ({
      id: service.id, name: service.name, category: service.category,
      serviceCategory: service.serviceCategory, price: service.price.toString(),
    }))}
  />;
}
