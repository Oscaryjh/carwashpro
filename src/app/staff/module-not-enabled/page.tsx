import type { Metadata } from "next";
import Link from "next/link";
import { moduleKeys, MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

export const metadata: Metadata = { title: "Module not enabled" };

export default async function StaffModuleNotEnabledPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const query = await searchParams;
  const moduleKey = moduleKeys.includes(query.module as ModuleKey) ? query.module as ModuleKey : null;
  return (
    <section className="staff-pwa-card">
      <p>MODULE_NOT_ENABLED</p>
      <h1>{moduleKey ? MODULE_REGISTRY[moduleKey].label : "This module"} is not enabled</h1>
      <p>Contact your business administrator if you need access. User permissions cannot override the business module entitlement.</p>
      <div className="staff-action-grid">
        <Link href="/staff" className="staff-secondary-button">Return to Home</Link>
        <Link href="/staff/profile" className="staff-secondary-button">Open My Profile</Link>
      </div>
    </section>
  );
}
