import type { Metadata } from "next";
import Link from "next/link";
import { moduleKeys, MODULE_REGISTRY, type ModuleKey } from "@/lib/modules/registry";

export const metadata: Metadata = { title: "Module not enabled" };

export default async function StaffModuleNotEnabledPage({ searchParams }: { searchParams: Promise<{ module?: string }> }) {
  const query = await searchParams;
  const moduleKey = moduleKeys.includes(query.module as ModuleKey) ? query.module as ModuleKey : null;
  return (
    <section className="staff-section-hero staff-system-state">
      <p>ACCESS</p>
      <h1>{moduleKey ? MODULE_REGISTRY[moduleKey].label : "This module"} is not enabled</h1>
      <p>Contact your administrator if you need access.</p>
      <Link href="/staff" className="staff-secondary-button">Back to Home</Link>
    </section>
  );
}
