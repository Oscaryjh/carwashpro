import Link from "next/link";
import { CatalogDiscountFormModal } from "@/components/catalog-discount-form-modal";
import { CatalogPagination } from "@/components/catalog-pagination";
import { DeleteCatalogDiscountForm } from "@/components/delete-catalog-discount-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { getActiveBranches } from "@/lib/branches";
import {
  formatCatalogDiscountScope,
  formatCatalogDiscountValue,
  type CatalogDiscountScope,
  type CatalogDiscountType,
} from "@/lib/catalog-discounts";
import { prisma } from "@/lib/prisma";
import { createCatalogDiscountAction, updateCatalogDiscountAction } from "./actions";

const PAGE_SIZE = 10;

export default async function DiscountsPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; message?: string; modal?: string; page?: string; type?: string }>;
}) {
  const { user, businessId } = await requireBusinessUser();
  assertStaffPermission(user, "DISCOUNTS");
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const [discounts, total, branches, editingDiscount] = await Promise.all([
    prisma.catalogDiscount.findMany({
      where: { businessId },
      include: { branch: { select: { name: true } } },
      orderBy: [{ active: "desc" }, { name: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.catalogDiscount.count({ where: { businessId } }),
    getActiveBranches(businessId),
    params.edit
      ? prisma.catalogDiscount.findFirst({ where: { id: params.edit, businessId } })
      : Promise.resolve(null),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const messageType = params.type === "error" ? "error" : "success";

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Discounts</h1>
            <p>Reusable percentage and fixed amount rules for services, products, and packages.</p>
          </div>
          <Link className="button-link" href="/discounts?modal=create">New discount</Link>
        </div>
        {params.message ? <div className={messageType}>{params.message}</div> : null}
        <div className="panel">
          {discounts.length ? (
            <>
              <div className="catalog-table-scroll">
                <table className="table catalog-table catalog-discount-table">
                  <thead><tr><th>Discount</th><th>Value</th><th>Scope</th><th>Branch</th><th>Validity</th><th>Status</th><th>Actions</th></tr></thead>
                  <tbody>
                    {discounts.map((discount) => (
                      <tr key={discount.id}>
                        <td><strong>{discount.name}</strong><div className="muted">Min. RM{Number(discount.minimumSpend).toFixed(2)}{discount.maximumDiscount == null ? "" : ` · Cap RM${Number(discount.maximumDiscount).toFixed(2)}`}</div></td>
                        <td><strong>{formatCatalogDiscountValue({
                          discountType: discount.discountType as CatalogDiscountType,
                          percentage: discount.percentage == null ? null : Number(discount.percentage),
                          fixedAmount: discount.fixedAmount == null ? null : Number(discount.fixedAmount),
                        })}</strong></td>
                        <td>{formatCatalogDiscountScope(discount.scope as CatalogDiscountScope)}</td>
                        <td>{discount.branch?.name ?? "All branches"}</td>
                        <td>{formatValidity(discount.startsAt, discount.endsAt)}</td>
                        <td><span className={`status ${discount.active ? "active" : "inactive"}`}>{discount.active ? "Active" : "Inactive"}</span></td>
                        <td><div className="catalog-table-actions"><Link href={`/discounts?edit=${discount.id}`}>Edit</Link><DeleteCatalogDiscountForm discountId={discount.id} discountName={discount.name} /></div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <CatalogPagination basePath="/discounts" currentPage={page} pageSize={PAGE_SIZE} query={{}} total={total} totalPages={pageCount} />
            </>
          ) : (
            <div className="empty-state catalog-discount-empty"><h3>No discounts yet</h3><p>Create a percentage or fixed amount rule when you are ready to run a promotion.</p></div>
          )}
        </div>
      </section>
      {params.modal === "create" ? <CatalogDiscountFormModal action={createCatalogDiscountAction} branches={branches} /> : null}
      {editingDiscount ? (
        <CatalogDiscountFormModal
          action={updateCatalogDiscountAction}
          branches={branches}
          discount={{
            ...editingDiscount,
            discountType: editingDiscount.discountType as CatalogDiscountType,
            percentage: editingDiscount.percentage == null ? null : Number(editingDiscount.percentage),
            fixedAmount: editingDiscount.fixedAmount == null ? null : Number(editingDiscount.fixedAmount),
            minimumSpend: Number(editingDiscount.minimumSpend),
            maximumDiscount: editingDiscount.maximumDiscount == null ? null : Number(editingDiscount.maximumDiscount),
            scope: editingDiscount.scope as CatalogDiscountScope,
          }}
        />
      ) : null}
    </>
  );
}

function formatValidity(startsAt: Date | null, endsAt: Date | null) {
  if (!startsAt && !endsAt) return "Always";
  const format = (value: Date) => value.toLocaleDateString("en-MY", { day: "2-digit", month: "short", year: "numeric" });
  if (startsAt && endsAt) return `${format(startsAt)} - ${format(endsAt)}`;
  return startsAt ? `From ${format(startsAt)}` : `Until ${format(endsAt as Date)}`;
}
