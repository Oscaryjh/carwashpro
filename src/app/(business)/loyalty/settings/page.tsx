import { redirect } from "next/navigation";
import { updateLoyaltySettingsAction } from "@/app/(business)/loyalty/actions";
import { LoyaltyTabs } from "@/components/loyalty-tabs";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { prisma } from "@/lib/prisma";

type LoyaltySettingsPageProps = {
  searchParams: Promise<{
    type?: string;
    message?: string;
  }>;
};

export default async function LoyaltySettingsPage({
  searchParams,
}: LoyaltySettingsPageProps) {
  const { businessId, user } = await requireBusinessUserForModule("LOYALTY");
  assertStaffPermission(user, "LOYALTY");

  if (user.role !== "BUSINESS_OWNER") {
    redirect("/loyalty");
  }

  const [params, program] = await Promise.all([
    searchParams,
    prisma.loyaltyProgram.findUnique({ where: { businessId } }),
  ]);

  return (
    <>
      <section className="content loyalty-content">
        <div className="page-header">
          <div>
            <h1>Membership</h1>
            <p>Configure how customers earn and redeem loyalty points.</p>
          </div>
        </div>

        {params.message ? (
          <div className={params.type === "error" ? "alert error" : "alert success"}>
            {params.message}
          </div>
        ) : null}

        <LoyaltyTabs active="settings" showSettings />

        <div className="panel loyalty-settings-panel">
          <div className="section-header">
            <div>
              <h2>Program settings</h2>
              <p className="muted">Package voucher uses do not earn points again.</p>
            </div>
          </div>
          <form action={updateLoyaltySettingsAction} className="loyalty-settings-form">
            <label>
              <span>Program name</span>
              <input name="name" defaultValue={program?.name ?? "Loyalty Member"} required />
            </label>
            <label>
              <span>Points per RM1</span>
              <input
                name="pointsPerRinggit"
                type="number"
                min="0"
                max="100"
                step="0.01"
                defaultValue={Number(program?.pointsPerRinggit ?? 1)}
                required
              />
            </label>
            <label>
              <span>Welcome points</span>
              <input
                name="welcomePoints"
                type="number"
                min="0"
                max="100000"
                step="1"
                defaultValue={program?.welcomePoints ?? 0}
                required
              />
            </label>
            <label className="loyalty-enabled-toggle">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={program?.enabled ?? true}
              />
              <span>
                <strong>Earn points automatically</strong>
                <small>Allow eligible purchases to add loyalty points.</small>
              </span>
            </label>
            <label>
              <span>Points required for RM1</span>
              <input
                name="redemptionPointsPerRinggit"
                type="number"
                min="1"
                max="1000000"
                step="1"
                defaultValue={program?.redemptionPointsPerRinggit ?? 100}
                required
              />
            </label>
            <label>
              <span>Minimum redemption</span>
              <input
                name="minimumRedemptionPoints"
                type="number"
                min="1"
                max="1000000"
                step="1"
                defaultValue={program?.minimumRedemptionPoints ?? 100}
                required
              />
            </label>
            <label className="loyalty-enabled-toggle">
              <input
                name="redemptionEnabled"
                type="checkbox"
                defaultChecked={program?.redemptionEnabled ?? false}
              />
              <span>
                <strong>Allow points at checkout</strong>
                <small>Customers can use points as a discount in Cashier POS.</small>
              </span>
            </label>
            <button type="submit">Save settings</button>
          </form>
        </div>
      </section>
    </>
  );
}
