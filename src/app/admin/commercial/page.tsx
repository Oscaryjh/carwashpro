import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { formatCents } from "@/lib/commercial/money";
import {
  getEffectiveCommercialConfiguration,
  reconcileCommercialState,
} from "@/lib/commercial/service";
import { MODULE_REGISTRY, moduleKeys } from "@/lib/modules/registry";
import { prisma } from "@/lib/prisma";
import {
  activateVersionAction,
  addSubscriptionItemAction,
  createPlanAction,
  createPriceOverrideAction,
  createPromotionAction,
  createSubscriptionAction,
  createVersionAction,
  renewSubscriptionAction,
} from "./actions";
import styles from "../admin-directory.module.css";

export default async function CommercialPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; message?: string; page?: string }>;
}) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = 25;
  const [
    plans,
    subscriptions,
    subscriptionCount,
    businesses,
    groups,
    promotions,
  ] = await Promise.all([
    prisma.commercialPlan.findMany({
      include: {
        versions: {
          include: {
            modules: true,
            _count: { select: { subscriptionItems: true } },
          },
          orderBy: { version: "desc" },
        },
      },
      orderBy: [
        { scopeType: "asc" },
        { planType: "asc" },
        { displayName: "asc" },
      ],
    }),
    prisma.commercialSubscription.findMany({
      include: {
        business: true,
        group: true,
        items: { include: { planVersion: { include: { plan: true } } } },
        overrides: {
          where: { status: "ACTIVE" },
          orderBy: { revision: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.commercialSubscription.count(),
    prisma.business.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.businessGroup.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.commercialPromotion.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const activeVersions = plans.flatMap((plan) =>
    plan.versions
      .filter((version) => version.status === "ACTIVE")
      .map((version) => ({ ...version, plan })),
  );
  const summaries = await Promise.all(
    subscriptions.map(async (subscription) => ({
      subscription,
      effective: await getEffectiveCommercialConfiguration(
        subscription.businessId
          ? { businessId: subscription.businessId }
          : { groupId: subscription.groupId! },
      ),
      health: await reconcileCommercialState(
        subscription.businessId
          ? { businessId: subscription.businessId }
          : { groupId: subscription.groupId! },
      ),
    })),
  );

  const subscribedBusinesses = new Set(
    subscriptions.flatMap((row) => (row.businessId ? [row.businessId] : [])),
  ).size;
  const legacyCustomers = Math.max(0, businesses.length - subscribedBusinesses);

  return (
    <AppShell user={user}>
      <section className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Platform commercial</p>
            <h1>Commercial</h1>
            <p className={styles.heroDescription}>
              Manage sellable plans, pricing versions, promotions and customer
              subscriptions. Billing records are handled separately.
            </p>
          </div>
          <div className={styles.heroActions}>
            <Link
              href="/admin/commercial/billing"
              className={styles.secondaryAction}
            >
              Billing records
            </Link>
            <Link href="#new-plan" className={styles.primaryAction}>
              + New plan
            </Link>
          </div>
        </header>
        {query.message ? (
          <p
            className={`${styles.message} ${query.type === "error" ? styles.messageError : styles.messageSuccess}`}
          >
            {query.message}
          </p>
        ) : null}
        <section className={styles.metrics} aria-label="Commercial summary">
          <article className={styles.metric}>
            <span>Plans</span>
            <strong>{plans.length}</strong>
            <small>Base plans and add-ons</small>
          </article>
          <article className={styles.metric}>
            <span>Active versions</span>
            <strong>{activeVersions.length}</strong>
            <small>Available to assign</small>
          </article>
          <article className={styles.metric}>
            <span>Subscriptions</span>
            <strong>{subscriptionCount}</strong>
            <small>Business and group customers</small>
          </article>
          <article className={styles.metric}>
            <span>Needs plan review</span>
            <strong>{legacyCustomers}</strong>
            <small>Active businesses without a subscription</small>
          </article>
        </section>
        <nav className={styles.quickNav} aria-label="Commercial sections">
          <a href="#plans">Plans</a>
          <a href="#promotions">Promotions</a>
          <a href="#assign-subscription">Assign subscription</a>
          <a href="#subscriptions">Customer subscriptions</a>
        </nav>

        <details className={styles.disclosure} id="new-plan">
          <summary>
            <span className={styles.disclosureTitle}>
              <strong>Create a plan</strong>
              <span>
                Start with a draft, then add and activate a priced version.
              </span>
            </span>
          </summary>
          <div className={styles.disclosureContent}>
            <form action={createPlanAction} className={styles.formGrid}>
              <input
                type="hidden"
                name="operationKey"
                value={`CREATE_PLAN:${randomUUID()}`}
              />
              <label className={styles.field}>
                <span>Plan code</span>
                <input name="code" required />
              </label>
              <label className={styles.field}>
                <span>Display name</span>
                <input name="displayName" required />
              </label>
              <label className={styles.field}>
                <span>Customer scope</span>
                <select name="scopeType">
                  <option value="BUSINESS">Business</option>
                  <option value="GROUP">Business group</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Plan type</span>
                <select name="planType">
                  <option value="BASE">Base plan</option>
                  <option value="ADD_ON">Add-on</option>
                </select>
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                <span>Description</span>
                <input name="description" />
              </label>
              <button>Create draft</button>
            </form>
          </div>
        </details>

        <section className={styles.panel} id="plans">
          <div className={styles.panelHeader}>
            <div>
              <h2>Plans and pricing versions</h2>
              <p>
                Published versions stay unchanged so existing subscriptions
                remain traceable.
              </p>
            </div>
            <span className={styles.countBadge}>{plans.length} plans</span>
          </div>
          <div className={`${styles.panelBody} ${styles.planStack}`}>
            {plans.length ? (
              plans.map((plan) => (
                <details className={styles.planCard} key={plan.id}>
                  <summary>
                    <strong>{plan.displayName}</strong>
                    <span className={styles.subtext}>
                      {plan.code} ·{" "}
                      {plan.scopeType === "BUSINESS" ? "Business" : "Group"} ·{" "}
                      {plan.planType === "BASE" ? "Base plan" : "Add-on"}
                    </span>
                  </summary>
                  <div className={styles.planCardBody}>
                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Version</th>
                            <th>Status</th>
                            <th>Monthly</th>
                            <th>Annual</th>
                            <th>Modules</th>
                            <th>Allowances</th>
                            <th>Customers</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {plan.versions.map((version) => (
                            <tr key={version.id}>
                              <td>v{version.version}</td>
                              <td>
                                <span
                                  className={`${styles.statusBadge} ${version.status === "ACTIVE" ? "" : styles.statusBadgeInactive}`}
                                >
                                  {version.status === "ACTIVE"
                                    ? "Active"
                                    : "Draft"}
                                </span>
                              </td>
                              <td>
                                {formatCents(version.monthlyListPriceCents)}
                              </td>
                              <td>
                                {formatCents(version.annualListPriceCents)}
                              </td>
                              <td>
                                {version.modules
                                  .map(
                                    (row) =>
                                      MODULE_REGISTRY[row.moduleKey].label,
                                  )
                                  .join(", ") || "Core only"}
                              </td>
                              <td>
                                {version.includedBranches ?? "—"} branches ·{" "}
                                {version.includedEmployees ?? "—"} employees ·{" "}
                                {version.businessAiAllowance ??
                                  version.groupAiAllowance ??
                                  0}{" "}
                                Ask
                              </td>
                              <td>{version._count.subscriptionItems}</td>
                              <td>
                                {version.status === "DRAFT" ? (
                                  <form action={activateVersionAction}>
                                    <input
                                      type="hidden"
                                      name="operationKey"
                                      value={`ACTIVATE_VERSION:${version.id}`}
                                    />
                                    <input
                                      type="hidden"
                                      name="planVersionId"
                                      value={version.id}
                                    />
                                    <button>Activate</button>
                                  </form>
                                ) : (
                                  <span className={styles.subtext}>Locked</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <form
                      action={createVersionAction}
                      className={`${styles.formGrid} ${styles.panelBody}`}
                    >
                      <input
                        type="hidden"
                        name="operationKey"
                        value={`CREATE_VERSION:${randomUUID()}`}
                      />
                      <input type="hidden" name="planId" value={plan.id} />
                      <label className={styles.field}>
                        <span>Effective from</span>
                        <input type="date" name="effectiveFrom" required />
                      </label>
                      <label className={styles.field}>
                        <span>Monthly price (RM)</span>
                        <input name="monthlyListPrice" inputMode="decimal" />
                      </label>
                      <label className={styles.field}>
                        <span>Annual price (RM)</span>
                        <input name="annualListPrice" inputMode="decimal" />
                      </label>
                      <label className={styles.field}>
                        <span>Setup fee (RM)</span>
                        <input name="setupFee" inputMode="decimal" />
                      </label>
                      <label className={styles.field}>
                        <span>Included branches</span>
                        <input type="number" min="0" name="includedBranches" />
                      </label>
                      <label className={styles.field}>
                        <span>Included employees</span>
                        <input type="number" min="0" name="includedEmployees" />
                      </label>
                      <label className={styles.field}>
                        <span>Business Ask allowance</span>
                        <input
                          type="number"
                          min="0"
                          name="businessAiAllowance"
                        />
                      </label>
                      <label className={styles.field}>
                        <span>Group Ask allowance</span>
                        <input type="number" min="0" name="groupAiAllowance" />
                      </label>
                      <fieldset>
                        <legend>Included modules</legend>
                        {moduleKeys
                          .filter((key) => key !== "CORE")
                          .map((key) => (
                            <label key={key}>
                              <input
                                type="checkbox"
                                name="modules"
                                value={key}
                              />
                              {MODULE_REGISTRY[key].label}
                            </label>
                          ))}
                      </fieldset>
                      <button>Create draft version</button>
                    </form>
                  </div>
                </details>
              ))
            ) : (
              <p className={styles.emptyState}>
                No commercial plans yet. Create the first draft above.
              </p>
            )}
          </div>
        </section>

        <details className={styles.disclosure} id="promotions">
          <summary>
            <span className={styles.disclosureTitle}>
              <strong>Promotions</strong>
              <span>
                {promotions.length
                  ? `${promotions.length} active promotions`
                  : "Create a time-limited discount for selected plan versions."}
              </span>
            </span>
          </summary>
          <div className={styles.disclosureContent}>
            <form action={createPromotionAction} className={styles.formGrid}>
              <input
                type="hidden"
                name="operationKey"
                value={`CREATE_PROMOTION:${randomUUID()}`}
              />
              <label className={styles.field}>
                <span>Name</span>
                <input name="name" required />
              </label>
              <label className={styles.field}>
                <span>Code</span>
                <input name="code" />
              </label>
              <label className={styles.field}>
                <span>Discount type</span>
                <select name="discountType">
                  <option value="PERCENT">Percentage</option>
                  <option value="FIXED_AMOUNT">Fixed amount (MYR)</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Value</span>
                <input name="discountValue" inputMode="decimal" required />
              </label>
              <label className={styles.field}>
                <span>Starts</span>
                <input type="date" name="effectiveFrom" required />
              </label>
              <label className={styles.field}>
                <span>Ends</span>
                <input type="date" name="effectiveTo" />
              </label>
              <label className={`${styles.field} ${styles.wide}`}>
                <span>Eligible plan versions</span>
                <select name="eligiblePlanVersionIds" multiple required>
                  {activeVersions.map((version) => (
                    <option value={version.id} key={version.id}>
                      {version.plan.displayName} v{version.version}
                    </option>
                  ))}
                </select>
              </label>
              <button>Create promotion</button>
            </form>
            {promotions.length ? (
              <p className={styles.subtext}>
                Active:{" "}
                {promotions.map((promotion) => promotion.name).join(" · ")}
              </p>
            ) : null}
          </div>
        </details>

        <details className={styles.disclosure} id="assign-subscription">
          <summary>
            <span className={styles.disclosureTitle}>
              <strong>Assign a subscription</strong>
              <span>
                Choose a customer, base plan, optional add-ons and billing
                period.
              </span>
            </span>
          </summary>
          <div className={styles.disclosureContent}>
            <form action={createSubscriptionAction} className={styles.formGrid}>
              <input
                type="hidden"
                name="operationKey"
                value={`CREATE_SUBSCRIPTION:${randomUUID()}`}
              />
              <label className={styles.field}>
                <span>Customer</span>
                <select name="scopeId" required>
                  <optgroup label="Businesses">
                    {businesses.map((business) => (
                      <option value={business.id} key={business.id}>
                        {business.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Business groups">
                    {groups.map((group) => (
                      <option value={group.id} key={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
              <label className={styles.field}>
                <span>Customer type</span>
                <select name="scopeType">
                  <option value="BUSINESS">Business</option>
                  <option value="GROUP">Business group</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Base plan</span>
                <select name="basePlanVersionId" required>
                  {activeVersions
                    .filter((version) => version.plan.planType === "BASE")
                    .map((version) => (
                      <option value={version.id} key={version.id}>
                        {version.plan.displayName} v{version.version}
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Add-ons</span>
                <select name="addOnPlanVersionIds" multiple>
                  {activeVersions
                    .filter((version) => version.plan.planType === "ADD_ON")
                    .map((version) => (
                      <option value={version.id} key={version.id}>
                        {version.plan.displayName} v{version.version}
                      </option>
                    ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Promotion</span>
                <select name="promotionId">
                  <option value="">No promotion</option>
                  {promotions.map((promotion) => (
                    <option value={promotion.id} key={promotion.id}>
                      {promotion.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Billing interval</span>
                <select name="billingInterval">
                  <option value="MONTHLY">Monthly</option>
                  <option value="ANNUAL">Annual</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Start date</span>
                <input type="date" name="startDate" required />
              </label>
              <label className={styles.field}>
                <span>Renewal date</span>
                <input type="date" name="renewalDate" required />
              </label>
              <button>Assign subscription</button>
            </form>
          </div>
        </details>

        <section className={styles.panel} id="subscriptions">
          <div className={styles.panelHeader}>
            <div>
              <h2>Customer subscriptions</h2>
              <p>
                Review the effective plan, price, allowances and renewal status
                for each customer.
              </p>
            </div>
            <span className={styles.countBadge}>
              {subscriptionCount} subscriptions
            </span>
          </div>
          {summaries.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th>Plan</th>
                    <th>Effective price</th>
                    <th>Allowances</th>
                    <th>Renewal</th>
                    <th>Health</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {summaries.map(({ subscription, effective, health }) => (
                    <tr key={subscription.id}>
                      <td>
                        <strong>
                          {subscription.business?.name ??
                            subscription.group?.name}
                        </strong>
                        <div className={styles.subtext}>
                          {subscription.scopeType === "BUSINESS"
                            ? "Business"
                            : "Business group"}
                        </div>
                      </td>
                      <td>
                        {subscription.items
                          .filter((item) => item.status === "ACTIVE")
                          .map(
                            (item) =>
                              `${item.planVersion.plan.displayName} v${item.planVersion.version}`,
                          )
                          .join(" + ")}
                      </td>
                      <td>
                        {effective.price ? (
                          <>
                            <strong>
                              {formatCents(
                                effective.price.effectiveRecurringPriceCents,
                              )}
                            </strong>
                            <div className={styles.subtext}>
                              List{" "}
                              {formatCents(effective.price.listSubtotalCents)}
                              {effective.price.promotionDiscountCents
                                ? ` · Discount -${formatCents(effective.price.promotionDiscountCents)}`
                                : ""}
                            </div>
                          </>
                        ) : (
                          "Price review required"
                        )}
                      </td>
                      <td>
                        {effective.allowances
                          ? `${effective.allowances.branches} branches · ${effective.allowances.employees} employees · ${effective.allowances.businessAi || effective.allowances.groupAi} Ask`
                          : "Legacy configuration"}
                      </td>
                      <td>
                        {subscription.renewalDate.toLocaleDateString("en-MY")}
                      </td>
                      <td>
                        <span
                          className={`${styles.statusBadge} ${health.status === "MATCH" ? "" : styles.statusBadgeInactive}`}
                        >
                          {health.status === "MATCH"
                            ? "Ready"
                            : health.status
                                .toLocaleLowerCase()
                                .replaceAll("_", " ")}
                        </span>
                        {health.issues.length ? (
                          <div className={styles.subtext}>
                            {health.issues.join(", ")}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <details>
                          <summary className={styles.rowAction}>Manage</summary>
                          <form
                            action={createPriceOverrideAction}
                            className={styles.inlineForm}
                          >
                            <input
                              type="hidden"
                              name="operationKey"
                              value={`OVERRIDE:${randomUUID()}`}
                            />
                            <input
                              type="hidden"
                              name="subscriptionId"
                              value={subscription.id}
                            />
                            <select name="overrideType">
                              <option value="PRICE">Price (MYR)</option>
                              <option value="BRANCH_ALLOWANCE">
                                Branch allowance
                              </option>
                              <option value="EMPLOYEE_ALLOWANCE">
                                Employee allowance
                              </option>
                              <option
                                value={
                                  subscription.scopeType === "BUSINESS"
                                    ? "BUSINESS_AI_ALLOWANCE"
                                    : "GROUP_AI_ALLOWANCE"
                                }
                              >
                                Ask allowance
                              </option>
                            </select>
                            <input name="value" placeholder="Value" required />
                            <input type="date" name="effectiveFrom" required />
                            <input type="date" name="effectiveTo" />
                            <input
                              name="reason"
                              placeholder="Reason"
                              minLength={5}
                              required
                            />
                            <button>Apply override</button>
                          </form>
                          <form
                            action={addSubscriptionItemAction}
                            className={styles.inlineForm}
                          >
                            <input
                              type="hidden"
                              name="operationKey"
                              value={`ADD_ITEM:${randomUUID()}`}
                            />
                            <input
                              type="hidden"
                              name="subscriptionId"
                              value={subscription.id}
                            />
                            <select name="planVersionId" required>
                              {activeVersions
                                .filter(
                                  (version) =>
                                    version.plan.planType === "ADD_ON" &&
                                    version.plan.scopeType ===
                                      subscription.scopeType,
                                )
                                .map((version) => (
                                  <option value={version.id} key={version.id}>
                                    {version.plan.displayName} v
                                    {version.version}
                                  </option>
                                ))}
                            </select>
                            <input
                              type="number"
                              name="quantity"
                              min="1"
                              defaultValue="1"
                            />
                            <button>Add add-on</button>
                          </form>
                          <form
                            action={renewSubscriptionAction}
                            className={styles.inlineForm}
                          >
                            <input
                              type="hidden"
                              name="operationKey"
                              value={`RENEW:${randomUUID()}`}
                            />
                            <input
                              type="hidden"
                              name="subscriptionId"
                              value={subscription.id}
                            />
                            <input
                              type="hidden"
                              name="expectedRevision"
                              value={subscription.revision}
                            />
                            <input type="date" name="renewalDate" required />
                            <input
                              name="reason"
                              minLength={5}
                              placeholder="Renewal reason"
                              required
                            />
                            <button>Renew</button>
                          </form>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.emptyState}>
              No subscriptions yet. Assign the first one above; existing
              businesses keep their current modules until then.
            </p>
          )}
          <nav className={styles.pagination}>
            {page > 1 ? (
              <Link href={`/admin/commercial?page=${page - 1}`}>Previous</Link>
            ) : null}
            <span>
              Showing {(page - 1) * pageSize + (summaries.length ? 1 : 0)}–
              {(page - 1) * pageSize + summaries.length} of {subscriptionCount}
            </span>
            {page * pageSize < subscriptionCount ? (
              <Link href={`/admin/commercial?page=${page + 1}`}>Next</Link>
            ) : null}
          </nav>
        </section>
      </section>
    </AppShell>
  );
}
