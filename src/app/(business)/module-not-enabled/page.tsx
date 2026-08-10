import Link from "next/link";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { MODULE_REGISTRY, moduleKeys, type ModuleKey } from "@/lib/modules/registry";

export default async function ModuleNotEnabledPage({
  searchParams,
}: {
  searchParams: Promise<{ module?: string }>;
}) {
  await requireBusinessUser();
  const params = await searchParams;
  const moduleKey = moduleKeys.includes(params.module as ModuleKey)
    ? (params.module as ModuleKey)
    : null;
  const label = moduleKey ? MODULE_REGISTRY[moduleKey].label : "This module";

  return (
    <section className="content">
      <div className="panel empty-state">
        <p className="eyebrow">MODULE_NOT_ENABLED</p>
        <h1>{label} is not enabled</h1>
        <p>This module is not enabled for this business. Your user permissions do not override the business entitlement.</p>
        <Link className="button-link" href="/business/settings">View enabled modules</Link>
      </div>
    </section>
  );
}
