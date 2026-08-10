"use server";

import { FinancialOperationType } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuditRequestContext, writeAuditLog } from "@/lib/audit";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { resolveOperationalBranchId } from "@/lib/branches";
import { nextInvoiceNumber } from "@/lib/invoices/invoice-number";
import { awardLoyaltyPointsForPayment } from "@/lib/loyalty/service";
import { prisma } from "@/lib/prisma";
import { calculateTax } from "@/lib/tax/calculator";
import { fromCents } from "@/lib/validation/pos";
import { productSaleSchema, productSchema } from "@/lib/validation/products";
import { sendInvoiceIfConnected } from "@/lib/whatsapp/invoice-notifications";
import { runFinancialOperation } from "@/lib/financial-idempotency";

export type DeleteProductState = {
  status: "idle" | "success" | "error";
  message: string;
};

function money(value: number | null | undefined) {
  return value == null ? null : fromCents(Math.round(value * 100));
}

function redirectProductMessage(type: "error" | "success", message: string): never {
  redirect(`/products?type=${type}&message=${encodeURIComponent(message)}`);
}

function redirectProductFormMessage(
  path: string,
  type: "error" | "success",
  message: string,
): never {
  redirect(`${path}?type=${type}&message=${encodeURIComponent(message)}`);
}

function productFormReturnPath(formData: FormData) {
  return formData.get("returnPath")?.toString() === "/products" ? "/products" : "/products/new";
}

function parseProductInput(formData: FormData) {
  return productSchema.parse({
    name: formData.get("name"),
    sku: formData.get("sku")?.toString() || undefined,
    categoryId: formData.get("categoryId")?.toString() || "",
    description: formData.get("description")?.toString() || undefined,
    price: formData.get("price"),
    costPrice: formData.get("costPrice"),
    taxable: formData.get("taxable") === "on",
    taxRate: formData.get("taxRate"),
    status: formData.get("status") || "ACTIVE",
  });
}

async function resolveStockRows(businessId: string, formData: FormData) {
  const branches = await prisma.branch.findMany({
    where: { businessId, status: "ACTIVE" },
    select: { id: true },
  });
  const allowed = new Set(branches.map((branch) => branch.id));

  return branches.map((branch) => ({
    branchId: branch.id,
    quantity: Math.max(0, Number(formData.get(`stock_${branch.id}`) ?? 0) || 0),
    reorderLevel: Math.max(0, Number(formData.get(`reorder_${branch.id}`) ?? 0) || 0),
  })).filter((row) => allowed.has(row.branchId));
}

export async function createProductAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const input = productSchema.parse(parseProductInput(formData));
  const category = await resolveProductCategory(businessId, input.categoryId, productFormReturnPath(formData));
  const stocks = await resolveStockRows(businessId, formData);
  const duplicate = await prisma.product.findFirst({
    where: { businessId, name: input.name },
    select: { id: true },
  });

  if (duplicate) {
    redirectProductFormMessage(productFormReturnPath(formData), "error", "Product name already exists.");
  }

  const product = await prisma.product.create({
    data: {
      businessId,
      name: input.name,
      sku: input.sku || null,
      categoryId: category.id,
      category: category.name,
      description: input.description || null,
      price: money(input.price) ?? "0.00",
      costPrice: money(input.costPrice),
      taxable: input.taxable,
      taxRate: money(input.taxRate),
      status: input.status,
      stocks: { create: stocks.map((stock) => ({ businessId, ...stock })) },
    },
  });

  revalidatePath("/products");
  redirect(`/products/${product.id}`);
}

export async function updateProductAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const productId = formData.get("productId")?.toString();

  if (!productId) {
    redirectProductMessage("error", "Product is required.");
  }

  const input = productSchema.parse(parseProductInput(formData));
  const category = await resolveProductCategory(businessId, input.categoryId, `/products/${productId}`);
  const stocks = await resolveStockRows(businessId, formData);
  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true },
  });

  if (!product) {
    redirectProductMessage("error", "Product could not be found.");
  }

  const duplicate = await prisma.product.findFirst({
    where: { businessId, name: input.name, id: { not: product.id } },
    select: { id: true },
  });

  if (duplicate) {
    redirectProductFormMessage(`/products/${product.id}`, "error", "Product name already exists.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: product.id },
      data: {
        name: input.name,
        sku: input.sku || null,
        categoryId: category.id,
        category: category.name,
        description: input.description || null,
        price: money(input.price) ?? "0.00",
        costPrice: money(input.costPrice),
        taxable: input.taxable,
        taxRate: money(input.taxRate),
        status: input.status,
      },
    });

    for (const stock of stocks) {
      await tx.productStock.upsert({
        where: { branchId_productId: { branchId: stock.branchId, productId: product.id } },
        create: { businessId, productId: product.id, ...stock },
        update: { quantity: stock.quantity, reorderLevel: stock.reorderLevel },
      });
    }
  });

  revalidatePath("/products");
  revalidatePath(`/products/${product.id}`);
  redirect(`/products/${product.id}`);
}

export async function deactivateProductAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const productId = formData.get("productId")?.toString();

  if (!productId) {
    redirectProductMessage("error", "Product is required.");
  }

  await prisma.product.updateMany({
    where: { id: productId, businessId },
    data: { status: "INACTIVE" },
  });

  revalidatePath("/products");
  revalidatePath(`/products/${productId}`);
  redirect(`/products/${productId}`);
}

export async function deleteProductAction(
  _previousState: DeleteProductState,
  formData: FormData,
): Promise<DeleteProductState> {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "PRODUCTS");
  const productId = formData.get("productId")?.toString();

  if (!productId) {
    return { status: "error", message: "Product is required." };
  }

  const product = await prisma.product.findFirst({
    where: { id: productId, businessId },
    include: { _count: { select: { invoiceItems: true } } },
  });

  if (!product) {
    return { status: "error", message: "Product not found." };
  }

  if (product._count.invoiceItems > 0) {
    return {
      status: "error",
      message:
        "Cannot delete this product because it has existing invoice records. Set status to Inactive instead.",
    };
  }

  await prisma.product.delete({ where: { id: product.id } });
  revalidatePath("/products");
  revalidatePath("/cashier");
  redirect("/products");
}

async function resolveProductCategory(businessId: string, categoryId: string, returnPath: string) {
  const category = await prisma.productCategory.findFirst({
    where: { id: categoryId, businessId, status: "ACTIVE" },
    select: { id: true, name: true },
  });

  if (!category) {
    redirectProductFormMessage(returnPath, "error", "Please select an active product category.");
  }

  return category;
}

export async function sellProductAction(formData: FormData) {
  const { user, businessId } = await requireBusinessUserForModule("POS");
  assertStaffPermission(user, "POS");
  const returnPath = formData.get("returnTo")?.toString() === "/cashier" ? "/cashier" : "/work-orders";
  const parsed = productSaleSchema.safeParse({
    operationId: formData.get("operationId"),
    branchId: formData.get("branchId")?.toString() || "",
    customerId: formData.get("customerId")?.toString() || "",
    method: formData.get("method")?.toString(),
    productIds: formData.getAll("productId").map((value) => value.toString()),
    quantities: formData.getAll("quantity"),
    reference: formData.get("reference")?.toString() || undefined,
  });

  if (!parsed.success) {
    redirectProductFormMessage(returnPath, "error", parsed.error.issues[0]?.message ?? "Product sale is invalid.");
  }

  const input = parsed.data;
  const auditRequest = await getAuditRequestContext();

  try {
    const branchId = await resolveOperationalBranchId(businessId, user, input.branchId || null);
    if (!branchId) {
      throw new Error("An active branch is required before selling a product.");
    }
    const { operationId, ...financialPayload } = input;
    const { result } = await runFinancialOperation({
      actorUserId: user.userId,
      branchId,
      businessId,
      operationKey: operationId,
      operationType: FinancialOperationType.CASHIER_CHECKOUT,
      payload: { ...financialPayload, branchId },
      execute: async (tx) => {
      const shift = await tx.cashierShift.findFirst({
        where: { businessId, cashierId: user.userId, status: "OPEN" },
        select: { id: true, branchId: true },
      });

      if (!shift) {
        throw new Error("Start a cashier shift before selling a product.");
      }

      if (shift.branchId !== branchId) {
        throw new Error("This product sale does not belong to the current shift branch.");
      }

      const customer = input.customerId
        ? await tx.customer.findFirst({
            where: { id: input.customerId, businessId },
            select: { id: true, name: true, phone: true },
          })
        : null;

      if (input.customerId && !customer) {
        throw new Error("Customer could not be found.");
      }

      const business = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { sstEnabled: true, sstLabel: true, sstRate: true },
      });

      const products = await tx.product.findMany({
        where: { id: { in: input.productIds }, businessId, status: "ACTIVE" },
      });
      const productById = new Map(products.map((product) => [product.id, product]));
      const lines = input.productIds.map((productId, index) => {
        const product = productById.get(productId);
        if (!product) {
          throw new Error("One of the selected products is no longer available.");
        }
        return { product, quantity: input.quantities[index] };
      });
      const stocks = await Promise.all(lines.map(async ({ product, quantity }) => {
        const stock = await tx.productStock.findUnique({
          where: { branchId_productId: { branchId, productId: product.id } },
        });
        if (!stock || stock.quantity < quantity) {
          throw new Error(`Not enough stock for ${product.name}.`);
        }
        return { product, quantity, stock };
      }));
      const lineTotals = stocks.map(({ product, quantity }) => Number(product.price) * quantity);
      const tax = calculateTax({
        sstEnabled: business.sstEnabled,
        sstLabel: business.sstLabel,
        sstRate: Number(business.sstRate),
        lines: stocks.map(({ product }, index) => ({
          lineTotal: lineTotals[index],
          taxable: product.taxable,
          taxRate: product.taxRate == null ? null : Number(product.taxRate),
        })),
      });
      const invoice = await tx.invoice.create({
        data: {
          businessId,
          branchId,
          customerId: customer?.id ?? null,
          invoiceNumber: await nextInvoiceNumber(tx, businessId),
          subtotal: fromCents(Math.round(tax.subtotal * 100)),
          taxableSubtotal: fromCents(Math.round(tax.taxableSubtotal * 100)),
          taxAmount: fromCents(Math.round(tax.tax * 100)),
          taxRate: fromCents(Math.round(tax.taxRate * 100)),
          taxLabel: tax.tax > 0 ? tax.taxLabel : null,
          total: fromCents(Math.round(tax.total * 100)),
          paidAmount: fromCents(Math.round(tax.total * 100)),
          balance: "0.00",
          status: "PAID",
          items: {
            create: stocks.map(({ product, quantity }, index) => ({
              businessId,
              productId: product.id,
              name: product.name,
              quantity,
              unitPrice: product.price,
              lineTotal: fromCents(Math.round(lineTotals[index] * 100)),
              taxable: product.taxable,
              taxRate: fromCents(Math.round((product.taxable ? Number(product.taxRate ?? business.sstRate) : 0) * 100)),
              taxAmount: fromCents(Math.round(tax.lineTax[index] * 100)),
            })),
          },
        },
      });
      const payment = await tx.payment.create({
        data: {
          businessId,
          branchId,
          cashierId: user.userId,
          shiftId: shift.id,
          invoiceId: invoice.id,
          amount: fromCents(Math.round(tax.total * 100)),
          method: input.method,
          reference: input.reference || `${stocks.length} product sale`,
        },
      });

      for (const { stock, quantity } of stocks) {
        const updated = await tx.productStock.updateMany({
          where: { id: stock.id, quantity: { gte: quantity } },
          data: { quantity: { decrement: quantity } },
        });
        if (updated.count !== 1) {
          throw new Error(`Not enough stock for ${productById.get(stock.productId)?.name ?? "product"}.`);
        }
      }

      if (customer) {
        await awardLoyaltyPointsForPayment(tx, {
          businessId,
          branchId,
          customerId: customer.id,
          paymentId: payment.id,
          amountCents: Math.round(tax.total * 100),
          paymentMethod: payment.method,
          createdById: user.userId,
        });
      }

      await writeAuditLog({
        businessId,
        branchId,
        actor: user,
        action: "PRODUCT_SALE_PAID",
        entityType: "Payment",
        entityId: payment.id,
        summary: `Sold ${stocks.length} products`,
        after: { products: stocks.map(({ product, quantity }) => ({ productId: product.id, quantity })), amount: payment.amount, method: payment.method },
        metadata: { customerId: customer?.id ?? null, invoiceId: invoice.id },
        request: auditRequest,
      }, tx);

      return { customerId: customer?.id ?? null, invoiceId: invoice.id };
      },
    });

    if (result.customerId) {
      await sendInvoiceIfConnected({ businessId, invoiceId: result.invoiceId, sentByUserId: user.userId });
      revalidatePath(`/crm/customers/${result.customerId}`);
    }

    revalidatePath(returnPath);
    revalidatePath("/products");
    revalidatePath("/invoices");
    revalidatePath(`/invoices/${result.invoiceId}`);
    revalidatePath("/reports");
    revalidatePath("/dashboard");
    revalidatePath("/closing");
  } catch (error) {
    redirectProductFormMessage(returnPath, "error", error instanceof Error ? error.message : "Unable to complete product sale.");
  }

  // Keep the success redirect outside the error handler so Next.js does not
  // mistake its internal redirect signal for a failed sale.
  redirectProductFormMessage(returnPath, "success", "Product sale completed.");
}
