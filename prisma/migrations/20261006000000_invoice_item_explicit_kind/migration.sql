-- Explicit identity for new writes; historical rows intentionally remain NULL.
CREATE TYPE "InvoiceItemKind" AS ENUM ('SERVICE', 'PACKAGE_PURCHASE', 'PRODUCT', 'OTHER');

ALTER TABLE "invoice_items" ADD COLUMN "kind" "InvoiceItemKind";
