import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const CASHIER_CATALOG_PAGE_SIZE = 8;

export type CashierCatalogType = "all" | "package" | "product" | "service";

export type CashierCatalogItem = {
  category: string | null;
  description: string;
  id: string;
  name: string;
  price: number;
  stock?: number;
  taxable: boolean;
  taxRate: number | null;
  type: Exclude<CashierCatalogType, "all">;
};

export type CashierCatalogResult = {
  categories: string[];
  items: CashierCatalogItem[];
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
};

type CashierCatalogInput = {
  branchId: string;
  businessId: string;
  category?: string;
  page?: number;
  query?: string;
  type?: CashierCatalogType;
};

export async function getCashierCatalog({
  branchId,
  businessId,
  category,
  page = 1,
  query = "",
  type = "all",
}: CashierCatalogInput): Promise<CashierCatalogResult> {
  const packageWhere = buildPackageWhere(businessId, category, query);
  const productWhere = buildProductWhere(businessId, category, query);
  const serviceWhere = buildServiceWhere(businessId, branchId, category, query);
  const [packageCount, productCount, serviceCount, categories] = await Promise.all([
    type === "all" || type === "package" ? prisma.package.count({ where: packageWhere }) : Promise.resolve(0),
    type === "all" || type === "product" ? prisma.product.count({ where: productWhere }) : Promise.resolve(0),
    type === "all" || type === "service" ? prisma.service.count({ where: serviceWhere }) : Promise.resolve(0),
    getCashierCatalogCategories(businessId, type),
  ]);
  const total = packageCount + productCount + serviceCount;
  const pageCount = Math.max(1, Math.ceil(total / CASHIER_CATALOG_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const offset = (safePage - 1) * CASHIER_CATALOG_PAGE_SIZE;
  const items: CashierCatalogItem[] = [];

  if ((type === "all" || type === "package") && offset < packageCount) {
    const packageRows = await prisma.package.findMany({
      where: packageWhere,
      include: {
        packageCategory: { select: { name: true } },
        service: { select: { taxable: true, taxRate: true } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: offset,
      take: CASHIER_CATALOG_PAGE_SIZE,
    });
    items.push(...packageRows.map((item) => ({
      category: item.packageCategory?.name ?? null,
      description: `${item.totalUses} total uses`,
      id: item.id,
      name: item.name,
      price: Number(item.price),
      taxable: item.service?.taxable ?? true,
      taxRate: item.service?.taxRate == null ? null : Number(item.service.taxRate),
      type: "package" as const,
    })));
  }

  const productOffset = type === "product"
    ? offset
    : Math.max(0, offset - packageCount);
  const productTake = CASHIER_CATALOG_PAGE_SIZE - items.length;

  if ((type === "all" || type === "product") && productTake > 0 && productOffset < productCount) {
    const productRows = await prisma.product.findMany({
      where: productWhere,
      include: {
        productCategory: { select: { name: true } },
        stocks: {
          where: { branchId },
          select: { quantity: true },
          take: 1,
        },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: productOffset,
      take: productTake,
    });
    items.push(...productRows.map((item) => ({
      category: item.productCategory?.name ?? item.category,
      description: `${item.stocks[0]?.quantity ?? 0} in stock`,
      id: item.id,
      name: item.name,
      price: Number(item.price),
      stock: item.stocks[0]?.quantity ?? 0,
      taxable: item.taxable,
      taxRate: item.taxRate == null ? null : Number(item.taxRate),
      type: "product" as const,
    })));
  }

  const serviceOffset = type === "service"
    ? offset
    : Math.max(0, offset - packageCount - productCount);
  const serviceTake = CASHIER_CATALOG_PAGE_SIZE - items.length;

  if ((type === "all" || type === "service") && serviceTake > 0 && serviceOffset < serviceCount) {
    const serviceRows = await prisma.service.findMany({
      where: serviceWhere,
      include: { serviceCategory: { select: { name: true } } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: serviceOffset,
      take: serviceTake,
    });
    items.push(...serviceRows.map((item) => ({
      category: item.serviceCategory?.name ?? item.category,
      description: item.durationMinutes ? `${item.durationMinutes} min` : "Flexible duration",
      id: item.id,
      name: item.name,
      price: Number(item.price),
      taxable: item.taxable,
      taxRate: item.taxRate == null ? null : Number(item.taxRate),
      type: "service" as const,
    })));
  }

  return {
    categories,
    items,
    page: safePage,
    pageCount,
    pageSize: CASHIER_CATALOG_PAGE_SIZE,
    total,
  };
}

async function getCashierCatalogCategories(
  businessId: string,
  type: CashierCatalogType,
) {
  const [packageCategories, productCategories, legacyProductCategories, serviceCategories, legacyServiceCategories] = await Promise.all([
    type === "all" || type === "package"
      ? prisma.packageCategory.findMany({
          where: { businessId, status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { name: true },
        })
      : Promise.resolve([]),
    type === "all" || type === "product"
      ? prisma.productCategory.findMany({
          where: { businessId, status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { name: true },
        })
      : Promise.resolve([]),
    type === "all" || type === "product"
      ? prisma.product.findMany({
          distinct: ["category"],
          where: { businessId, category: { not: null }, status: "ACTIVE" },
          select: { category: true },
        })
      : Promise.resolve([]),
    type === "all" || type === "service"
      ? prisma.serviceCategory.findMany({
          where: { businessId, status: "ACTIVE" },
          orderBy: { name: "asc" },
          select: { name: true },
        })
      : Promise.resolve([]),
    type === "all" || type === "service"
      ? prisma.service.findMany({
          distinct: ["category"],
          where: { businessId, category: { not: null }, status: "ACTIVE" },
          select: { category: true },
        })
      : Promise.resolve([]),
  ]);

  return Array.from(new Set([
    ...packageCategories.map((item) => item.name),
    ...productCategories.map((item) => item.name),
    ...legacyProductCategories.map((item) => item.category).filter((value): value is string => Boolean(value)),
    ...serviceCategories.map((item) => item.name),
    ...legacyServiceCategories.map((item) => item.category).filter((value): value is string => Boolean(value)),
  ])).sort((left, right) => left.localeCompare(right));
}

function buildServiceWhere(
  businessId: string,
  branchId: string,
  category: string | undefined,
  query: string,
): Prisma.ServiceWhereInput {
  const normalizedQuery = query.trim();
  return {
    businessId,
    status: "ACTIVE",
    OR: [{ branchId: null }, { branchId }],
    ...(category
      ? {
          AND: [{
            OR: [
              { category },
              { serviceCategory: { name: category } },
            ],
          }],
        }
      : {}),
    ...(normalizedQuery
      ? {
          AND: [
            ...(category
              ? [{
                  OR: [
                    { category },
                    { serviceCategory: { name: category } },
                  ],
                }]
              : []),
            {
              OR: [
                { name: { contains: normalizedQuery, mode: "insensitive" } },
                { description: { contains: normalizedQuery, mode: "insensitive" } },
                { category: { contains: normalizedQuery, mode: "insensitive" } },
                { serviceCategory: { name: { contains: normalizedQuery, mode: "insensitive" } } },
              ],
            },
          ],
        }
      : {}),
  };
}

function buildPackageWhere(
  businessId: string,
  category: string | undefined,
  query: string,
): Prisma.PackageWhereInput {
  const normalizedQuery = query.trim();
  return {
    businessId,
    status: "ACTIVE",
    ...(category ? { packageCategory: { name: category } } : {}),
    ...(normalizedQuery
      ? {
          OR: [
            { name: { contains: normalizedQuery, mode: "insensitive" } },
            { description: { contains: normalizedQuery, mode: "insensitive" } },
            { packageCategory: { name: { contains: normalizedQuery, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

function buildProductWhere(
  businessId: string,
  category: string | undefined,
  query: string,
): Prisma.ProductWhereInput {
  const normalizedQuery = query.trim();
  return {
    businessId,
    status: "ACTIVE",
    ...(category
      ? {
          OR: [
            { category },
            { productCategory: { name: category } },
          ],
        }
      : {}),
    ...(normalizedQuery
      ? {
          AND: [{
            OR: [
              { name: { contains: normalizedQuery, mode: "insensitive" } },
              { sku: { contains: normalizedQuery, mode: "insensitive" } },
              { category: { contains: normalizedQuery, mode: "insensitive" } },
              { productCategory: { name: { contains: normalizedQuery, mode: "insensitive" } } },
            ],
          }],
        }
      : {}),
  };
}
