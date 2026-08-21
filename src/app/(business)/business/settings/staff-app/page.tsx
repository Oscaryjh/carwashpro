import Link from "next/link";
import { notFound } from "next/navigation";
import { StaffAppAppearanceEditor } from "./staff-app-appearance-editor";
import { assertRole } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { requireBusinessContext } from "@/lib/tenant";
import { resolveStaffAppAppearance } from "@/lib/staff-pwa/appearance-config";
import styles from "./staff-app-appearance.module.css";

export default async function StaffAppAppearancePage() {
  const context = await requireBusinessContext({
    capability: "MODIFY_BUSINESS_SETTINGS",
  });
  assertRole(context.user, ["BUSINESS_OWNER"]);
  const business = await prisma.business.findUnique({
    where: { id: context.businessId },
    select: {
      name: true,
      staffAppLogoUrl: true,
      staffAppAppearance: true,
    },
  });

  if (!business) notFound();

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span>COMPANY SETTINGS</span>
          <h1>Staff App Appearance</h1>
          <p>Manage the logo and home shortcut icons employees see for {business.name}.</p>
        </div>
        <Link href="/business/settings">Back to settings</Link>
      </header>
      <StaffAppAppearanceEditor
        appearance={resolveStaffAppAppearance(
          business.staffAppAppearance,
          business.staffAppLogoUrl,
        )}
        businessName={business.name}
      />
    </section>
  );
}
