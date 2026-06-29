import { AppShell } from "@/components/app-shell";
import { BusinessForm } from "@/components/business-form";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { updateBusinessAction } from "@/app/admin/businesses/actions";
import { updateOwnerProfileAction } from "./actions";

type BusinessSettingsPageProps = {
  searchParams: Promise<{
    saved?: string;
  }>;
};

export default async function BusinessSettingsPage({
  searchParams,
}: BusinessSettingsPageProps) {
  const context = await requireBusinessContext();
  assertRole(context.user, ["BUSINESS_OWNER"]);
  const params = await searchParams;

  const [business, profile] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: context.businessId },
    }),
    prisma.user.findFirstOrThrow({
      where: {
        id: context.user.userId,
        businessId: context.businessId,
      },
      select: {
        whatsappPhone: true,
      },
    }),
  ]);

  return (
    <AppShell user={context.user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>Company settings</h1>
            <p>Manage your company profile.</p>
          </div>
        </div>

        <div className="panel">
          <BusinessForm
            action={updateBusinessAction}
            mode="edit"
            business={business}
          />
        </div>

        <div className="panel">
          <div className="section-header">
            <h2>Owner WhatsApp</h2>
            {params.saved === "profile" ? (
              <span className="status">saved</span>
            ) : null}
          </div>
          <form action={updateOwnerProfileAction} className="form">
            <div className="field-grid">
              <label>
                <span>Your WhatsApp Number</span>
                <input
                  defaultValue={profile.whatsappPhone ?? ""}
                  inputMode="numeric"
                  name="whatsappPhone"
                  placeholder="60123456789"
                />
              </label>
            </div>
            <div className="form-actions">
              <button type="submit">Save WhatsApp Number</button>
            </div>
          </form>
        </div>
      </section>
    </AppShell>
  );
}
