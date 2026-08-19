import type { Prisma } from "@prisma/client";

const PRODUCT_SKU_PREFIX = "SKU-";
const PRODUCT_SKU_WIDTH = 3;

type ProductSkuTransaction = Pick<Prisma.TransactionClient, "business">;

export function formatProductSku(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error("Product SKU sequence must be a positive integer.");
  }

  return `${PRODUCT_SKU_PREFIX}${String(sequence).padStart(PRODUCT_SKU_WIDTH, "0")}`;
}

export async function nextProductSku(
  transaction: ProductSkuTransaction,
  businessId: string,
) {
  const business = await transaction.business.update({
    where: { id: businessId },
    data: { productSequence: { increment: 1 } },
    select: { productSequence: true },
  });

  return formatProductSku(business.productSequence);
}
