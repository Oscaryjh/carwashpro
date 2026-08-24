import Link from "next/link";
import type { CommissionRuleRevision } from "@prisma/client";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { getCommissionManagerDashboard } from "@/lib/commission/read";
import {
  approveCommissionPeriodAction,
  calculateCommissionPeriodAction,
  createCommissionCorrectionAction,
  createCommissionRuleAction,
  linkCommissionToPayrollAction,
  recoverCommissionSourcesAction,
  reviseCommissionRuleAction,
} from "./actions";
import { CommissionRuleBuilder } from "./commission-rule-builder";
import styles from "./commission.module.css";

type Props = { searchParams: Promise<{ type?: string; message?: string; view?: string }> };
type Dashboard = Awaited<ReturnType<typeof getCommissionManagerDashboard>>;
type DashboardRule = Dashboard["rules"][number];
type DashboardPeriod = Dashboard["periods"][number];

const statusLabels: Record<string, string> = {
  CALCULATED: "Ready for review",
  LOCKED: "Approved",
  APPROVED: "Approved",
  APPLIED_TO_PAYROLL: "Sent to Payroll",
};

export default async function CommissionPage({ searchParams }: Props) {
  const { businessId, access } = await requireBusinessUserForModule("COMMISSION", "VIEW_COMMISSION");
  const data = await getCommissionManagerDashboard({
    businessId,
    branchId: access.effectiveBusinessRole === "STAFF" ? access.branchId : null,
  });
  const params = await searchParams;
  const canManage = hasBusinessCapability(access, "MANAGE_COMMISSION_RULES");
  const canEditStaffLevels = hasBusinessCapability(access, "EDIT_COMPENSATION");
  const canCalculate = hasBusinessCapability(access, "CALCULATE_COMMISSION");
  const canApprove = hasBusinessCapability(access, "APPROVE_COMMISSION");
  const canAdjust = hasBusinessCapability(access, "ADJUST_COMMISSION");
  const canLink = hasBusinessCapability(access, "LINK_COMMISSION_TO_PAYROLL");

  if (params.view === "settings") {
    return <SettingsPage canEditStaffLevels={canEditStaffLevels} canManage={canManage} data={data} message={params.message} messageType={params.type} />;
  }

  const reviewCount = data.sourceSummary.find((row) => row.attributionStatus === "REVIEW_REQUIRED")?._count._all ?? 0;
  const approvalCount = data.periods.filter((period) => period.status === "CALCULATED").length;
  const nowKey = monthKey(new Date());
  const approvedThisMonth = data.periods
    .filter((period) => period.status === "LOCKED" && period.approvedAt && monthKey(period.approvedAt) === nowKey)
    .reduce((total, period) => total + currentStatements(period).reduce((sum, statement) => sum + statement.finalCommissionCents, 0), 0);

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>WORKFORCE · PAY</p><h1>Commission</h1><span>Calculate, review and approve employee commission before sending it to Payroll.</span></div>
        <Link className={styles.manageLink} href="/team/commission?view=settings">Commission settings</Link>
      </header>
      <Notice message={params.message} type={params.type} />

      <section className={styles.summary} aria-label="Commission summary">
        {reviewCount > 0 ? <article className={styles.summaryWarning}><span>Needs review</span><strong>{reviewCount}</strong><small>sales missing staff attribution</small></article> : null}
        {approvalCount > 0 ? <article className={styles.summaryActive}><span>Ready to approve</span><strong>{approvalCount}</strong><small>commission period{approvalCount === 1 ? "" : "s"}</small></article> : null}
        <article><span>Approved this month</span><strong>{money(approvedThisMonth)}</strong><small>approved commission, not employee payment</small></article>
      </section>

      {canCalculate ? <section className={styles.workflowPanel}>
        <div className={styles.workflowIntro}><p className={styles.eyebrow}>NEW PERIOD</p><h2>Calculate monthly commission</h2><p>Uses eligible paid POS sales and the rates effective during the selected month.</p></div>
        <form action={calculateCommissionPeriodAction} className={styles.monthForm}>
          <label>Commission month<input defaultValue={nowKey} name="commissionMonth" required type="month" /></label>
          <button>Calculate commission</button>
        </form>
        <details className={styles.advancedPeriod}>
          <summary>Advanced · Custom date range</summary>
          <form action={calculateCommissionPeriodAction} className={styles.customDateForm}>
            <label>From<input name="earnedPeriodStart" required type="date" /></label>
            <label>Through<input name="earnedPeriodEnd" required type="date" /></label>
            <button>Calculate custom period</button>
          </form>
        </details>
        <details className={styles.syncDisclosure}>
          <summary>Refresh sales data</summary>
          <div><p>Re-check eligible paid sales, refunds and voids before calculating again.</p><form action={recoverCommissionSourcesAction}><button className={styles.secondaryButton}>Refresh POS sales</button></form></div>
        </details>
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>STATEMENTS</p><h2>Commission periods</h2><span>Approved periods are frozen and remain unchanged when rates change later.</span></div><span>{data.periods.length} period{data.periods.length === 1 ? "" : "s"}</span></div>
        <div className={styles.periods}>{data.periods.length ? data.periods.map((period) => {
          const statements = currentStatements(period);
          const periodTotal = statements.reduce((total, statement) => total + statement.finalCommissionCents, 0);
          return <article key={period.id} className={styles.period}>
            <header className={styles.periodHeader}>
              <div><strong>{formatPeriod(period.earnedPeriodStart, period.earnedPeriodEnd)}</strong><span>{period.branch?.name ?? "All branches"} · {statements.length} employee{statements.length === 1 ? "" : "s"}</span></div>
              <div><b>{money(periodTotal)}</b><span className={styles.status} data-status={period.status}>{statusLabels[period.status] ?? humanize(period.status)}</span></div>
            </header>
            <details className={styles.periodReview}>
              <summary>{period.status === "CALCULATED" ? "Review period" : "View statement"}</summary>
              <div className={styles.statements}>{statements.map((statement) => {
                const totals = sourceTotals(statement.accruals);
                return <article className={styles.statement} key={statement.id}>
                  <div className={styles.employee}><span>{initials(statement.membership.fullName)}</span><div><strong>{statement.membership.fullName}</strong><small>{statement.membership.employeeCode}</small></div></div>
                  <div className={styles.sourceBreakdown}>{Object.entries(totals).map(([source, amount]) => <span key={source}>{sourceLabel(source)} <b>{money(amount)}</b></span>)}</div>
                  <div className={styles.statementAmount}><strong>{money(statement.finalCommissionCents)}</strong><span>Total commission</span></div>
                  <details className={styles.trace}><summary>View breakdown</summary><div className={styles.traceBody}>
                    {statement.accruals.length ? <ul>{statement.accruals.map((accrual) => <li key={accrual.id}><span>{formatDate(accrual.sourceEvent.businessDate)} · {sourceLabel(accrual.sourceEvent.sourceType)}</span><strong>{money(accrual.commissionAmountCents)}</strong><small>{money(accrual.eligibleAmountCents)} eligible sale</small></li>)}</ul> : <p>No eligible source lines.</p>}
                    {statement.originatingAdjustments.map((adjustment, index) => <div className={styles.adjustment} key={`${adjustment.type}-${index}`}><span>{humanize(adjustment.type)} · {adjustment.reason}</span><strong>{money(adjustment.commissionAmountCents)}</strong></div>)}
                  </div></details>
                  <div className={styles.statementActions}>
                    {canLink && statement.status === "APPROVED" ? <form action={linkCommissionToPayrollAction}><input name="statementId" type="hidden" value={statement.id} /><label>Payroll month<input name="targetPayrollMonth" required type="month" /></label><button>Send to Payroll</button></form> : null}
                    {canAdjust && statement.status !== "CALCULATED" ? <details><summary>Add correction</summary><form action={createCommissionCorrectionAction}><input name="statementId" type="hidden" value={statement.id} /><label>Correction amount (RM)<input name="amountRinggit" placeholder="For example, 10.00 or -10.00" required step="0.01" type="number" /></label><label>Reason<input maxLength={500} minLength={5} name="reason" required /></label><button>Save future correction</button></form></details> : null}
                  </div>
                </article>;
              })}</div>
              {canApprove && period.status === "CALCULATED" ? <form action={approveCommissionPeriodAction} className={styles.approve}><input name="periodId" type="hidden" value={period.id} /><input name="expectedRevision" type="hidden" value={period.currentRevision} /><label>Approval note<input maxLength={500} minLength={5} name="reason" placeholder="Confirm why this period is ready" required /></label><button>Approve and lock</button></form> : null}
            </details>
          </article>;
        }) : <div className={styles.empty}><strong>No commission periods yet</strong><span>Choose a month above to calculate the first statement.</span></div>}</div>
      </section>

      <section className={styles.settingsCta}><div><strong>Commission settings</strong><span>{data.rules.filter((rule) => rule.status === "ACTIVE").length} active rates · company, employee and item overrides</span></div><Link href="/team/commission?view=settings">Manage rates</Link></section>
    </main>
  );
}

function SettingsPage({ canEditStaffLevels, canManage, data, message, messageType }: { canEditStaffLevels: boolean; canManage: boolean; data: Dashboard; message?: string; messageType?: string }) {
  const activeRules = data.rules.filter((rule) => rule.status === "ACTIVE");
  const groups = {
    company: activeRules.filter((rule) => latest(rule)?.scope !== "MEMBER" && latest(rule)?.scope !== "ITEM"),
    employee: activeRules.filter((rule) => latest(rule)?.scope === "MEMBER" && !latest(rule)?.itemId),
    item: activeRules.filter((rule) => latest(rule)?.scope === "ITEM" || Boolean(latest(rule)?.itemId)),
  };
  const catalogs = { SERVICE: data.catalogs.services, PRODUCT: data.catalogs.products, PACKAGE_PURCHASE: data.catalogs.packages } as const;
  const categories = { SERVICE: data.catalogs.serviceCategories, PRODUCT: data.catalogs.productCategories, PACKAGE_PURCHASE: data.catalogs.packageCategories } as const;
  return <main className={styles.page}>
    <header className={styles.pageHeader}>
      <div><Link className={styles.backLink} href="/team/commission">← Commission</Link><p className={styles.eyebrow}>COMMISSION SETTINGS</p><h1>Commission rates</h1><span>Set who earns commission, what they earn it from and when a rate starts.</span></div>
      {canEditStaffLevels ? <Link className={styles.manageLink} href="/team?section=roles&focus=levels">Staff levels</Link> : null}
    </header>
    <Notice message={message} type={messageType} />
    <section className={styles.priorityGuide}><div><p className={styles.eyebrow}>RATE PRIORITY</p><h2>The most specific matching rate is used</h2><span>Rates never stack.</span></div><ol><li>Employee + specific item</li><li>Employee rate</li><li>Specific item</li><li>Category rate</li><li>Company default</li></ol></section>
    <section className={styles.settingsOverview}>
      <SettingTile count={groups.company.length} label="Company default rates" />
      <SettingTile label="Staff level rates" note={`${data.staffLevels.length} HR level${data.staffLevels.length === 1 ? "" : "s"} exist, but the current Commission engine does not apply rates by level.`} value="Not available" />
      <SettingTile count={groups.employee.length} label="Employee rates" />
      <SettingTile count={groups.item.length} label="Specific item rates" />
    </section>
    <section className={styles.panel}>
      <div className={styles.panelTitle}><div><p className={styles.eyebrow}>ACTIVE RATES</p><h2>Current commission rates</h2><span>Review each rate by employee, item and effective date.</span></div></div>
      <div className={styles.humanRuleGroups}><RuleGroup title="Company and category rates" rules={groups.company} data={data} canManage={canManage} /><RuleGroup title="Employee rates" rules={groups.employee} data={data} canManage={canManage} /><RuleGroup title="Specific item rates" rules={groups.item} data={data} canManage={canManage} /></div>
    </section>
    {canManage ? <section className={styles.panel}><div className={styles.panelTitle}><div><p className={styles.eyebrow}>NEW RATE</p><h2>Create commission rule</h2><span>Choose plain-language options. Tetamu maps them to the existing versioned rule engine.</span></div></div><CommissionRuleBuilder action={createCommissionRuleAction} branches={data.branches} catalogs={catalogs} categories={categories} memberships={data.memberships} /></section> : null}
    <section className={styles.policyNote}><strong>How sales are handled</strong><span>Only eligible completed and paid POS sales are included. Refunds and voids use the existing append-only adjustment workflow. Sales without an explicit employee remain blocked for review.</span></section>
  </main>;
}

function RuleGroup({ canManage, data, rules, title }: { canManage: boolean; data: Dashboard; rules: Dashboard["rules"]; title: string }) {
  return <section className={styles.ruleGroup}><h3>{title}<span>{rules.length}</span></h3>{rules.length ? <div>{rules.map((rule) => {
    const revision = latest(rule)!;
    return <article className={styles.humanRule} key={rule.id}>
      <div className={styles.ruleIdentity}><span className={styles.ruleMark}>{sourceInitial(rule.sourceType)}</span><div><strong>{ruleSubject(rule.sourceType, revision, data)}</strong><span>{ruleContext(rule.sourceType, revision, data)}</span></div></div>
      <div className={styles.ruleRate}><strong>{ruleValue(revision)}</strong><span>{revision.basis === "GROSS" ? "Before discounts" : "After discounts"}</span></div>
      <div className={styles.ruleDates}><span>Effective from</span><strong>{formatDate(revision.effectiveFrom)}</strong>{revision.effectiveUntil ? <small>Ends {formatDate(revision.effectiveUntil)}</small> : null}</div>
      <details className={styles.ruleHistory}><summary>History</summary><div>{rule.revisions.map((item) => <p key={item.id}><strong>{ruleValue(item)}</strong><span>{formatDate(item.effectiveFrom)}{item.effectiveUntil ? ` – ${formatDate(item.effectiveUntil)}` : " onward"}</span></p>)}</div></details>
      {canManage ? <details className={styles.changeRate}><summary>Change rate</summary><CommissionRuleBuilder action={reviseCommissionRuleAction} branches={data.branches} catalogs={{ SERVICE: data.catalogs.services, PRODUCT: data.catalogs.products, PACKAGE_PURCHASE: data.catalogs.packages }} categories={{ SERVICE: data.catalogs.serviceCategories, PRODUCT: data.catalogs.productCategories, PACKAGE_PURCHASE: data.catalogs.packageCategories }} initial={builderInitial(rule, revision)} memberships={data.memberships} /></details> : null}
    </article>;
  })}</div> : <p className={styles.emptySmall}>No rates configured in this group.</p>}</section>;
}

function SettingTile({ count, label, note, value }: { count?: number; label: string; note?: string; value?: string }) { return <article><strong>{label}</strong><b>{value ?? `${count ?? 0} configured`}</b>{note ? <span>{note}</span> : null}</article>; }
function Notice({ message, type }: { message?: string; type?: string }) { if (!message) return null; const safe = /Prisma|ConnectorError|invocation|^[A-Z0-9_]+$/.test(message) ? "Commission could not be updated. Check the selected settings and try again." : message; return <div className={type === "error" ? styles.error : styles.success}>{safe}</div>; }
function latest(rule: DashboardRule) { return rule.revisions[0] ?? null; }
function currentStatements(period: DashboardPeriod) { return period.statements.filter((statement) => statement.calculationRevision === period.currentRevision); }
function monthKey(value: Date) { return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Kuala_Lumpur" }).format(value); }
function dateInput(value: Date | null) { return value ? value.toISOString().slice(0, 10) : ""; }
function formatDate(value: Date) { return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value); }
function formatPeriod(start: Date, end: Date) { return start.getUTCDate() === 1 && end.getUTCDate() >= 28 && start.getUTCMonth() === end.getUTCMonth() ? new Intl.DateTimeFormat("en-MY", { month: "long", year: "numeric", timeZone: "UTC" }).format(start) : `${formatDate(start)} – ${formatDate(end)}`; }
function money(cents: number) { return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(cents / 100); }
function humanize(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase()); }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(""); }
function sourceLabel(value: string) { return ({ SERVICE: "Services", PRODUCT: "Products", PACKAGE_PURCHASE: "Packages" } as Record<string, string>)[value] ?? humanize(value); }
function sourceInitial(value: string) { return value === "SERVICE" ? "S" : value === "PRODUCT" ? "P" : "PK"; }
function sourceTotals(accruals: Array<{ sourceEvent: { sourceType: string }; commissionAmountCents: number }>) { return accruals.reduce<Record<string, number>>((result, accrual) => ({ ...result, [accrual.sourceEvent.sourceType]: (result[accrual.sourceEvent.sourceType] ?? 0) + accrual.commissionAmountCents }), {}); }
function ruleValue(revision: Pick<CommissionRuleRevision, "ruleType" | "rateBasisPoints" | "fixedAmountCents" | "tiers">) { if (revision.ruleType === "PERCENTAGE") return `${trim((revision.rateBasisPoints ?? 0) / 100)}%`; if (revision.ruleType === "FIXED_AMOUNT") return `${money(revision.fixedAmountCents ?? 0)} / item`; const tiers = tierRows(revision.tiers); return tiers.length ? `${tiers.length} tiers · up to ${trim(tiers.at(-1)!.rateBasisPoints / 100)}%` : "Tiered rate"; }
function trim(value: number) { return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"); }
function tierRows(value: unknown) { return Array.isArray(value) ? value.filter((item): item is { fromCents: number; rateBasisPoints: number } => Boolean(item) && typeof item === "object" && "fromCents" in item && "rateBasisPoints" in item) : []; }
function entityName<T extends { id: string; name: string; status?: string }>(items: T[], id: string | null, fallback: string) { const item = items.find((candidate) => candidate.id === id); return item ? `${item.name}${item.status && item.status !== "ACTIVE" ? " · Archived" : ""}` : fallback; }
function ruleSubject(sourceType: string, revision: CommissionRuleRevision, data: Dashboard) { if (revision.scope === "MEMBER") return data.memberships.find((member) => member.id === revision.scopeId)?.fullName ?? "Former employee"; if (revision.scope === "ITEM") return entityName(sourceItems(sourceType, data), revision.scopeId, `Archived ${sourceLabel(sourceType).slice(0, -1).toLowerCase()}`); if (revision.scope === "CATEGORY") return entityName(sourceCategories(sourceType, data), revision.scopeId, "Archived category"); return `All ${sourceLabel(sourceType).toLowerCase()}`; }
function ruleContext(sourceType: string, revision: CommissionRuleRevision, data: Dashboard) { const branch = revision.branchId ? entityName(data.branches, revision.branchId, "Former branch") : "All branches"; if (revision.scope === "MEMBER" && revision.itemId) return `${entityName(sourceItems(sourceType, data), revision.itemId, "Archived item")} · ${branch}`; if (revision.scope === "MEMBER") return `All ${sourceLabel(sourceType).toLowerCase()} · Personal rate · ${branch}`; if (revision.scope === "ITEM") return `Specific ${sourceLabel(sourceType).slice(0, -1).toLowerCase()} · ${branch}`; if (revision.scope === "CATEGORY") return `${sourceLabel(sourceType)} category · ${branch}`; return `Company default · ${branch}`; }
function sourceItems(sourceType: string, data: Dashboard) { return sourceType === "PRODUCT" ? data.catalogs.products : sourceType === "PACKAGE_PURCHASE" ? data.catalogs.packages : data.catalogs.services; }
function sourceCategories(sourceType: string, data: Dashboard) { return sourceType === "PRODUCT" ? data.catalogs.productCategories : sourceType === "PACKAGE_PURCHASE" ? data.catalogs.packageCategories : data.catalogs.serviceCategories; }
function builderInitial(rule: DashboardRule, revision: CommissionRuleRevision) { return { ruleId: rule.id, expectedRevision: revision.revision, name: rule.name, sourceType: rule.sourceType as "SERVICE" | "PRODUCT" | "PACKAGE_PURCHASE", branchId: revision.branchId, scope: revision.scope, scopeId: revision.scopeId, itemId: revision.itemId, ruleType: revision.ruleType, basis: revision.basis, ratePercent: String((revision.rateBasisPoints ?? 0) / 100), fixedAmountRinggit: ((revision.fixedAmountCents ?? 0) / 100).toFixed(2), tiers: tierRows(revision.tiers).map((tier) => ({ fromRinggit: (tier.fromCents / 100).toFixed(2), ratePercent: String(tier.rateBasisPoints / 100) })), priority: revision.priority, effectiveFrom: dateInput(revision.effectiveFrom), effectiveUntil: dateInput(revision.effectiveUntil) }; }
