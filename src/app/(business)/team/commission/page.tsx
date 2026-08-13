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
  return <main className={styles.page}>
    <header><p>People / Commission</p><h1>Commission workspace</h1><span>POS facts, calculation, approval and Payroll inclusion remain separate controlled stages.</span></header>
    {params.message ? <div className={params.type === "error" ? styles.error : styles.success}>{params.message}</div> : null}
    <section className={styles.summary}><article><span>Rules</span><strong>{data.rules.length}</strong></article><article><span>Periods</span><strong>{data.periods.length}</strong></article><article><span>Attribution blockers</span><strong>{reviewCount}</strong></article></section>
    {canCalculate ? <section className={styles.panel}><div><h2>Recovery & calculation</h2><form action={recoverCommissionSourcesAction}><button>Recover paid POS, refunds & voids</button></form></div><form action={calculateCommissionPeriodAction} className={styles.grid}><label>Earned from<input name="earnedPeriodStart" type="date" required /></label><label>Earned through<input name="earnedPeriodEnd" type="date" required /></label><button>Calculate immutable revision</button></form><small>Package redemption is excluded. No cashier fallback. Split commission is deferred until POS captures line-level splits.</small></section> : null}
    <section className={styles.panel}><h2>Periods & frozen statements</h2><div className={styles.list}>{data.periods.length ? data.periods.map((period) => <article key={period.id}><div><strong>{date(period.earnedPeriodStart)} – {date(period.earnedPeriodEnd)}</strong><span>{period.branch?.name ?? "Whole business"} · {period.status} · Revision {period.currentRevision}</span></div>{period.statements.filter((statement) => statement.calculationRevision === period.currentRevision).map((statement) => <div className={styles.statement} key={statement.id}><span>{statement.membership.fullName} ({statement.membership.employeeCode})</span><strong>RM {(statement.finalCommissionCents / 100).toFixed(2)} · {statement.status}</strong><details><summary>View calculation trace</summary><ul>{statement.accruals.map((accrual) => <li key={accrual.id}>{date(accrual.sourceEvent.businessDate)} · {accrual.sourceEvent.sourceType} · RM {(accrual.eligibleAmountCents / 100).toFixed(2)} basis · RM {(accrual.commissionAmountCents / 100).toFixed(2)} · {accrual.ruleRevision.ruleType} r{accrual.ruleRevision.revision} ({accrual.ruleRevision.basis})</li>)}{statement.originatingAdjustments.map((adjustment, index) => <li key={`${adjustment.type}-${index}`}>{adjustment.type} · RM {(adjustment.commissionAmountCents / 100).toFixed(2)} · {adjustment.payrollStatus} · {adjustment.reason}</li>)}</ul></details>{canAdjust && statement.status !== "CALCULATED" ? <form action={createCommissionCorrectionAction}><input type="hidden" name="statementId" value={statement.id} /><input name="amountCents" type="number" placeholder="Correction cents (+/-)" required /><input name="reason" minLength={5} maxLength={500} placeholder="Correction reason" required /><button>Create future correction</button></form> : null}{canLink && statement.status === "APPROVED" ? <form action={linkCommissionToPayrollAction}><input type="hidden" name="statementId" value={statement.id} /><input name="targetPayrollMonth" type="month" required /><button>Link to Payroll</button></form> : null}</div>)}{canApprove && period.status === "CALCULATED" ? <form action={approveCommissionPeriodAction} className={styles.approve}><input type="hidden" name="periodId" value={period.id} /><input type="hidden" name="expectedRevision" value={period.currentRevision} /><input name="reason" minLength={5} maxLength={500} placeholder="Independent approval reason" required /><button>Approve & lock</button></form> : null}</article>) : <p>No commission periods yet.</p>}</div></section>
    <section className={styles.panel}><h2>Effective-dated rules</h2><div className={styles.list}>{data.rules.map((rule) => { const revision = rule.revisions[0]; return <article key={rule.id}><strong>{rule.name}</strong><span>{rule.sourceType} · {revision?.scope} · {revision?.ruleType} · revision {revision?.revision}</span></article>; })}</div>{canManage ? <form action={createCommissionRuleAction} className={styles.grid}><label>Name<input name="name" minLength={2} maxLength={120} required /></label><label>Source<select name="sourceType"><option>SERVICE</option><option>PRODUCT</option><option>PACKAGE_PURCHASE</option></select></label><label>Scope<select name="scope"><option>ALL</option><option>CATEGORY</option><option>ITEM</option></select></label><label>Scope UUID<input name="scopeId" placeholder="Only for category/item" /></label><label>Rule type<select name="ruleType"><option>PERCENTAGE</option><option>FIXED_AMOUNT</option><option>TIERED_PERCENTAGE</option></select></label><label>Basis<select name="basis"><option>NET_AFTER_DISCOUNT</option><option>GROSS</option></select></label><label>Rate (basis points)<input name="rateBasisPoints" type="number" min="0" /></label><label>Fixed cents<input name="fixedAmountCents" type="number" min="0" /></label><label>Tier rows<input name="tiers" placeholder="0:5;1000:8 (RM:percent)" /></label><label>Priority<input name="priority" type="number" defaultValue="0" /></label><label>Effective from<input name="effectiveFrom" type="date" required /></label><label>Effective until<input name="effectiveUntil" type="date" /></label><label className={styles.full}>Reason<input name="reason" minLength={5} maxLength={500} required /></label><button className={styles.full}>Create rule</button></form> : null}</section>
  </main>;
}

function date(value: Date) { return value.toISOString().slice(0, 10); }
