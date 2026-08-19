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
} from "./actions";
import styles from "./commission.module.css";

type Props = { searchParams: Promise<{ type?: string; message?: string }> };

const statusLabels: Record<string, string> = {
  CALCULATED: "Ready for approval",
  APPROVED: "Approved and locked",
  PAYROLL_LINKED: "Linked to Payroll",
  PAID: "Paid",
  DRAFT: "Draft",
};

export default async function CommissionPage({ searchParams }: Props) {
  const { businessId, access } = await requireBusinessUserForModule("COMMISSION", "VIEW_COMMISSION");
  const data = await getCommissionManagerDashboard({
    businessId,
    branchId: access.effectiveBusinessRole === "STAFF" ? access.branchId : null,
  });
  const params = await searchParams;
  const canManage = hasBusinessCapability(access, "MANAGE_COMMISSION_RULES");
  const canCalculate = hasBusinessCapability(access, "CALCULATE_COMMISSION");
  const canApprove = hasBusinessCapability(access, "APPROVE_COMMISSION");
  const canAdjust = hasBusinessCapability(access, "ADJUST_COMMISSION");
  const canLink = hasBusinessCapability(access, "LINK_COMMISSION_TO_PAYROLL");
  const reviewCount = data.sourceSummary.find((row) => row.attributionStatus === "REVIEW_REQUIRED")?._count._all ?? 0;
  const approvalCount = data.periods.filter((period) => period.status === "CALCULATED").length;

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>COMMISSION</p><h1>Commission</h1><span>Turn completed POS sales into reviewed commission, then send the approved amount to Payroll.</span></div>
        <div className={styles.attentionCount}><strong>{approvalCount + reviewCount}</strong><span>need attention</span></div>
      </header>

      {params.message ? <div className={params.type === "error" ? styles.error : styles.success}>{params.message}</div> : null}

      <section className={styles.summary} aria-label="Commission summary">
        <article className={approvalCount ? styles.summaryActive : undefined}><span>Ready to approve</span><strong>{approvalCount}</strong><small>Calculated commission periods</small></article>
        <article><span>Commission periods</span><strong>{data.periods.length}</strong><small>Current and historical periods</small></article>
        <article className={reviewCount ? styles.summaryWarning : undefined}><span>Sales need review</span><strong>{reviewCount}</strong><small>Missing staff attribution</small></article>
      </section>

      {canCalculate ? <section className={styles.workflowPanel}>
        <div className={styles.workflowIntro}><p className={styles.eyebrow}>NEW PERIOD</p><h2>Calculate commission</h2><p>Choose the earned dates. Tetamu uses eligible paid POS sales, refunds and voids.</p></div>
        <form action={calculateCommissionPeriodAction} className={styles.calculateForm}>
          <label>From<input name="earnedPeriodStart" type="date" required /></label>
          <label>Through<input name="earnedPeriodEnd" type="date" required /></label>
          <button>Calculate period</button>
        </form>
        <details className={styles.syncDisclosure}>
          <summary>Sales data not up to date?</summary>
          <div><p>Refresh eligible paid sales, refunds and voids before calculating again.</p><form action={recoverCommissionSourcesAction}><button className={styles.secondaryButton}>Refresh POS data</button></form></div>
        </details>
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.panelTitle}><div><p className={styles.eyebrow}>PERIODS</p><h2>Commission statements</h2><span>Calculated amounts remain unchanged after approval.</span></div><span>{data.periods.length} total</span></div>
        <div className={styles.periods}>{data.periods.length ? data.periods.map((period) => {
          const currentStatements = period.statements.filter((statement) => statement.calculationRevision === period.currentRevision);
          const periodTotal = currentStatements.reduce((total, statement) => total + statement.finalCommissionCents, 0);
          return (
            <article key={period.id} className={styles.period}>
              <header className={styles.periodHeader}>
                <div><strong>{formatDate(period.earnedPeriodStart)} – {formatDate(period.earnedPeriodEnd)}</strong><span>{period.branch?.name ?? "Whole business"} · Version {period.currentRevision}</span></div>
                <div><b>{money(periodTotal)}</b><span className={styles.status} data-status={period.status}>{statusLabels[period.status] ?? humanize(period.status)}</span></div>
              </header>

              <div className={styles.statements}>{currentStatements.map((statement) => (
                <article className={styles.statement} key={statement.id}>
                  <div className={styles.employee}><span>{initials(statement.membership.fullName)}</span><div><strong>{statement.membership.fullName}</strong><small>{statement.membership.employeeCode}</small></div></div>
                  <div className={styles.statementAmount}><strong>{money(statement.finalCommissionCents)}</strong><span>{statusLabels[statement.status] ?? humanize(statement.status)}</span></div>
                  <details className={styles.trace}>
                    <summary>Calculation details</summary>
                    <div className={styles.traceBody}>
                      {statement.accruals.length ? <ul>{statement.accruals.map((accrual) => <li key={accrual.id}><span>{formatDate(accrual.sourceEvent.businessDate)} · {sourceLabel(accrual.sourceEvent.sourceType)}</span><strong>{money(accrual.commissionAmountCents)}</strong><small>{money(accrual.eligibleAmountCents)} eligible · Rule version {accrual.ruleRevision.revision}</small></li>)}</ul> : <p>No source lines in this statement.</p>}
                      {statement.originatingAdjustments.map((adjustment, index) => <div className={styles.adjustment} key={`${adjustment.type}-${index}`}><span>{humanize(adjustment.type)} · {adjustment.reason}</span><strong>{money(adjustment.commissionAmountCents)}</strong></div>)}
                    </div>
                  </details>
                  <div className={styles.statementActions}>
                    {canLink && statement.status === "APPROVED" ? <form action={linkCommissionToPayrollAction}><input type="hidden" name="statementId" value={statement.id} /><label>Payroll month<input name="targetPayrollMonth" type="month" required /></label><button>Send to Payroll</button></form> : null}
                    {canAdjust && statement.status !== "CALCULATED" ? <details><summary>Add correction</summary><form action={createCommissionCorrectionAction}><input type="hidden" name="statementId" value={statement.id} /><label>Correction amount (cents)<input name="amountCents" type="number" placeholder="Use + or −" required /></label><label>Reason<input name="reason" minLength={5} maxLength={500} required /></label><button>Save future correction</button></form></details> : null}
                  </div>
                </article>
              ))}</div>

              {canApprove && period.status === "CALCULATED" ? <form action={approveCommissionPeriodAction} className={styles.approve}><input type="hidden" name="periodId" value={period.id} /><input type="hidden" name="expectedRevision" value={period.currentRevision} /><label>Approval note<input name="reason" minLength={5} maxLength={500} placeholder="Why is this period ready?" required /></label><button>Approve and lock period</button></form> : null}
            </article>
          );
        }) : <div className={styles.empty}><strong>No commission periods yet</strong><span>Choose a date range above to calculate the first period.</span></div>}</div>
      </section>

      <details className={styles.settingsPanel}>
        <summary><span><b>Commission rules</b><small>{data.rules.length} active rule{data.rules.length === 1 ? "" : "s"} · rates and eligible sales</small></span><span>Manage</span></summary>
        <div className={styles.settingsBody}>
          <div className={styles.ruleList}>{data.rules.length ? data.rules.map((rule) => { const revision = rule.revisions[0]; return <article key={rule.id}><div><strong>{rule.name}</strong><span>{sourceLabel(rule.sourceType)} · {scopeLabel(revision?.scope)}</span></div><div><b>{ruleValue(revision?.ruleType, revision?.rateBasisPoints, revision?.fixedAmountCents)}</b><span>Version {revision?.revision ?? "—"}</span></div></article>; }) : <div className={styles.emptySmall}>No commission rules have been created.</div>}</div>
          {canManage ? <details className={styles.newRule}>
            <summary>+ New commission rule</summary>
            <form action={createCommissionRuleAction} className={styles.grid}>
              <label>Rule name<input name="name" minLength={2} maxLength={120} required placeholder="e.g. Standard service commission" /></label>
              <label>Earned from<select name="sourceType"><option value="SERVICE">Services</option><option value="PRODUCT">Products</option><option value="PACKAGE_PURCHASE">Package sales</option></select></label>
              <label>Applies to<select name="scope"><option value="ALL">All items</option><option value="CATEGORY">One category</option><option value="ITEM">One item</option></select></label>
              <label>Category / item ID<input name="scopeId" placeholder="Only when scoped" /></label>
              <label>Calculation<select name="ruleType"><option value="PERCENTAGE">Percentage</option><option value="FIXED_AMOUNT">Fixed amount</option><option value="TIERED_PERCENTAGE">Tiered percentage</option></select></label>
              <label>Sales basis<select name="basis"><option value="NET_AFTER_DISCOUNT">After discounts</option><option value="GROSS">Before discounts</option></select></label>
              <label>Percentage rate (basis points)<input name="rateBasisPoints" type="number" min="0" placeholder="1000 = 10%" /></label>
              <label>Fixed amount (cents)<input name="fixedAmountCents" type="number" min="0" placeholder="1000 = RM10" /></label>
              <label>Tier rows<input name="tiers" placeholder="0:5;1000:8 (RM:percent)" /></label>
              <label>Priority<input name="priority" type="number" defaultValue="0" /></label>
              <label>Effective from<input name="effectiveFrom" type="date" required /></label>
              <label>Effective until (optional)<input name="effectiveUntil" type="date" /></label>
              <label className={styles.full}>Reason for change<input name="reason" minLength={5} maxLength={500} required /></label>
              <p className={`${styles.full} ${styles.ruleNote}`}>More specific rules take priority over general rules. Earlier statements are never recalculated automatically.</p>
              <button className={styles.full}>Save commission rule</button>
            </form>
          </details> : null}
        </div>
      </details>
    </main>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" }).format(value);
}

function money(cents: number) {
  return new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(cents / 100);
}

function humanize(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

function sourceLabel(value: string) {
  return ({ SERVICE: "Services", PRODUCT: "Products", PACKAGE_PURCHASE: "Package sales" } as Record<string, string>)[value] ?? humanize(value);
}

function scopeLabel(value?: string) {
  return ({ ALL: "All items", CATEGORY: "Category", ITEM: "Item" } as Record<string, string>)[value ?? ""] ?? humanize(value ?? "All");
}

function ruleValue(type?: string, rateBasisPoints?: number | null, fixedAmountCents?: number | null) {
  if (type === "PERCENTAGE") return `${((rateBasisPoints ?? 0) / 100).toFixed(2)}%`;
  if (type === "FIXED_AMOUNT") return money(fixedAmountCents ?? 0);
  if (type === "TIERED_PERCENTAGE") return "Tiered rate";
  return "Not configured";
}
