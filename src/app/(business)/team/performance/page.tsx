import Link from "next/link";
import { BranchSelect } from "@/components/branch-select";
import { selectedOrOnlyBranch } from "@/lib/branch-selection";
import { notFound } from "next/navigation";
import { requireBusinessUserWithAnyCapability } from "@/lib/auth/business-user";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { localPerformanceDate, performanceTimezone } from "@/lib/performance/time";
import { readPerformanceDashboard } from "@/lib/performance/dashboard";
import type { TargetSnapshot } from "@/lib/performance/targets-contract";
import { performanceMoney as money, performanceMonth, comparisonLabel } from "./display";
import { TargetEditor } from "./target-editor";
import styles from "./performance.module.css";

export const dynamic = "force-dynamic";
type Params = { range?: string; q?: string; branch?: string; year?: string; month?: string; tab?: string; employee?: string; page?: string; status?: string; component?: string };
const percent = (v: number | null) => v === null ? "N/A" : `${v.toFixed(2)}%`;
const statuses: Record<string,string> = { CAPTURED_VERIFIED:"Captured and verified", CAPTURED_VERIFIED_UNASSIGNED:"Verified · Unassigned", CAPTURED_PENDING:"Pending verification", UNCAPTURED:"Not captured", EXCLUDED_NONCASH:"Non-cash redemption · Excluded", EXCLUDED_WALLET_VOID:"Wallet void · Excluded" };
type Data = Awaited<ReturnType<typeof readPerformanceDashboard>>;
function Composition({value}:{value:Data["annual"]["team"]}) {
  return <dl className={styles.composition}><div><dt>Sales received</dt><dd>{money(value.salesReceived)}</dd></div><div><dt>Tips received</dt><dd>{money(value.tipsReceived)}</dd></div><div><dt>Refund deductions</dt><dd>− {money(value.refunds)}</dd></div></dl>;
}
export default async function PerformancePage({searchParams}:{searchParams:Promise<Params>}) {
  if(process.env.TETAMU_PERFORMANCE_PHASE2!=="true") notFound();
  const {businessId,user,access}=await requireBusinessUserWithAnyCapability(["PERFORMANCE_VIEW_TEAM","PERFORMANCE_MANAGE_TARGETS"]);
  if(access.source!=="DIRECT_BUSINESS") notFound();
  // Historical performance remains readable for authorised inactive locations.
  const branches=await prisma.branch.findMany({where:{businessId,...(user.role==="BUSINESS_OWNER"?{}:{id:user.branchId??"00000000-0000-0000-0000-000000000000"})},select:{id:true,name:true},orderBy:{name:"asc"}});
  const p=await searchParams;
  const requestedBranch = p.branch ?? user.branchId;
  const branch=selectedOrOnlyBranch(branches, requestedBranch);
  if (!branch && !requestedBranch && branches.length > 1) return <main className={styles.page}><h1>Performance</h1><p>Select a branch to view its performance.</p><form method="get" className={styles.filters}><BranchSelect branches={branches} name="branch" /><button type="submit">View</button></form></main>;
  if(!branch) notFound();
  const business=await prisma.business.findUniqueOrThrow({where:{id:businessId},select:{timezone:true}});
  const now=new Date(),today=localPerformanceDate(now,performanceTimezone(business.timezone));
  const year=Number(p.year??today.slice(0,4)),month=Number(p.month??today.slice(5,7));
  if(!Number.isInteger(year)||year<2001||year>2200||!Number.isInteger(month)||month<1||month>12) notFound();
  const tab=["overview","targets","details"].includes(p.tab??"")?p.tab!:"overview";
  const data=await readPerformanceDashboard({businessId,branchId:branch.id,actorUserId:user.userId},{year,month,asOf:now,employeeId:p.employee||undefined,page:Number(p.page??1),status:p.status||undefined,component:p.component||undefined,detailRange:p.range==="year"?"year":"month"});
  const canManage=hasBusinessCapability(access,"PERFORMANCE_MANAGE_TARGETS");
  const href=(extra:Params)=>`/team/performance?${new URLSearchParams(Object.entries({...p,branch:branch.id,year:String(year),month:String(month),tab,...extra}).filter(([,v])=>!!v) as [string,string][]).toString()}`;
  const date=(s:string)=>new Intl.DateTimeFormat("en-GB",{timeZone:data.timezone,dateStyle:"medium",timeStyle:"short"}).format(new Date(s));
  const selectedMember=data.members.find(m=>m.id===p.employee);
  const visibleMembers=data.members.filter(m=>!p.q||`${m.fullName} ${m.employeeCode}`.toLowerCase().includes(p.q.toLowerCase()));
  return <main className={styles.page}>
    <header className={styles.header}><div><h1>Performance</h1><p>Sales received and tips for this branch, less related refunds. Excludes tax, payroll and commission.</p></div>{!canManage&&<span className={styles.badge}>Branch view only</span>}</header>
    <form className={`${styles.filters} ${styles.periodFilters}`} method="get"><input type="hidden" name="tab" value={tab}/><BranchSelect branches={branches} selectedBranchId={branch.id} name="branch" /><label className={styles.yearControl}>Year<input aria-label="Performance year" name="year" type="number" min="2001" max="2200" defaultValue={year}/></label><label className={styles.monthControl}>Month<select name="month" defaultValue={month}>{Array.from({length:12},(_,i)=><option key={i} value={i+1}>{performanceMonth(i+1)}</option>)}</select></label><button type="submit">View</button></form>
    <nav className={styles.tabs} aria-label="Performance sections">{[["overview","Overview"],["targets","Targets"],["details","Performance details"]].map(([key,label])=><Link key={key} href={href({tab:key,page:"",employee:"",status:"",component:""})} aria-current={tab===key?"page":undefined}>{label}</Link>)}</nav>
    <div className={styles.meta}><span>Last updated {date(data.asOf)}</span><span>Year-to-date · {data.timezone}</span><details className={styles.coverage}><summary>Coverage</summary><p>{data.annual.started?`${date(data.annual.from)} – ${date(new Date(Math.min(new Date(data.annual.toExclusive).getTime()-1,now.getTime())).toISOString())}`:"This business year has not started. Targets can be set in advance."} · {data.timezone}</p></details></div>
    {!data.annual.complete&&<aside className={styles.warning}>Data incomplete: only verified subtotals are shown. Levels and completion rates are not yet confirmed. Not captured: {data.annual.uncapturedCount}, pending verification: {data.annual.pendingCount}, source evidence gaps: {data.annual.basisGapCount}. <Link href={href({tab:"details",status:"",page:"",range:"year"})}>View sources</Link></aside>}
    {tab==="overview"&&<>
      <div className={styles.kpiGrid}>
        <section className={`${styles.card} ${styles.kpiCard}`} aria-label="Year to date performance">
          <h2>Year to date <span className={styles.periodYear}>{year}</span></h2>
          <strong className={styles.amount}>{money(data.annual.team.total)}</strong>
          <p className={styles.secondary}>{branch.name} · {!data.annual.started?"This year has not started":data.annual.complete?"Data complete as of the reporting time":"Verified subtotal / Data incomplete"}</p>
          <Composition value={data.annual.team}/>
          <small>Year-to-date completion {percent(data.progress.percent)}</small>
        </section>
        <section className={`${styles.card} ${styles.kpiCard}`} aria-label="Monthly performance">
          <h2>{performanceMonth(month)} <span className={styles.periodYear}>{year}</span></h2>
          <strong className={styles.amount}>{data.comparison.future?"—":money(data.current.team.total)}</strong>
          <p className={styles.secondary}>{data.comparison.future?"Not started":data.comparison.complete?"Received performance":"Verified subtotal / Data incomplete"}</p>
          <dl className={styles.composition}>
            <div><dt>{comparisonLabel(data.comparison.label)}</dt><dd>{new Date(data.previous.from)>now?"Not started":money(data.previous.team.total)}</dd></div>
            <div><dt>{data.comparison.complete?"Change":"Verified subtotal change (growth unconfirmed)"}</dt><dd>{data.comparison.future?"—":<>{data.comparison.delta!==null&&data.comparison.delta>0?"+ ":""}{money(data.comparison.delta)}</>}</dd></div>
            <div><dt>Percentage change</dt><dd>{percent(data.comparison.percent)}</dd></div>
          </dl>
          <small>Percentage change is unavailable when the comparison period is zero or negative.</small>
          <details className={styles.periodDetails}><summary>Comparison periods</summary><p>{comparisonLabel(data.comparison.label)}: {date(data.previous.from)} – {date(data.previous.asOf)}</p><p>Current period: {data.comparison.future?"Not started":`${date(data.current.from)} – ${date(new Date(Math.min(now.getTime(),new Date(data.current.toExclusive).getTime()-1)).toISOString())}`}</p></details>
        </section>
      </div>
      <div className={styles.supportGrid}>
        <section className={styles.card}><h2>Performance levels</h2>
          <table className={styles.levelTable} aria-label="Performance levels"><thead><tr><th scope="col">Level</th><th scope="col">Annual target</th><th scope="col">Status</th></tr></thead><tbody>
            {(data.target?.levels??[null,null,null]).map((level,i)=><tr key={i}><th scope="row">Level {i+1}</th><td>{level===null?"—":money(level)}</td><td>{level===null?"Not set":!data.annual.started?"Not started":!data.annual.complete?"Unconfirmed":data.annual.team.total>=level?"Reached":"In progress"}{level!==null&&data.annual.complete&&data.annual.started&&<progress aria-label={`Team level ${i+1} progress`} max={level} value={Math.max(0,Math.min(data.annual.team.total,level))}/>}</td></tr>)}
          </tbody></table>
        </section>
        <section className={styles.card} aria-label="Progress and unassigned performance">
          <dl className={styles.progressMetrics}><div><dt>Current level</dt><dd>{data.level.level===null?"Unconfirmed":data.level.level===0?"Below Level 1":`Level ${data.level.level}`}</dd></div><div><dt>Next level gap</dt><dd>{money(data.level.nextGap)}</dd></div></dl>
          <div className={styles.unassigned}><h2>Unassigned performance</h2><div><strong>{money(data.annual.unassigned.total)}</strong><Link href={href({tab:"details",employee:"UNASSIGNED",page:"",range:"year"})}>View details</Link></div><small>Verified unassigned amounts are included in the team total.</small></div>
        </section>
      </div>
      <section className={styles.card}><h2>Team performance</h2>{data.annual.unassignedCount>0&&<p className={styles.warning}>Some receipts or refunds remain unassigned. Individual amounts show confirmed attribution only; individual completion rates are not yet confirmed.</p>}
        <form method="get" className={`${styles.filters} ${styles.memberSearch}`}><input name="tab" type="hidden" value="overview"/><input name="branch" type="hidden" value={branch.id}/><input name="year" type="hidden" value={year}/><input name="month" type="hidden" value={month}/><label>Find team member<input type="search" aria-label="Find performance member" name="q" defaultValue={p.q??""} placeholder="Name or employee ID"/></label><button type="submit">Search</button></form>
        <div className={styles.memberHeading} aria-hidden="true"><span>Name</span><span>Received · YTD</span><span>Annual target</span><span>Status</span></div>
        <ul className={styles.memberList} aria-label="Team performance members">{visibleMembers.map(m=><li key={m.id}><details className={styles.member} data-status={m.status}><summary>
          <span className={styles.memberName}><strong>{m.fullName}</strong><small>{m.employeeCode}{!m.eligible?" · Former branch member":""}</small></span>
          <span><span className={styles.srOnly}>Received year to date: </span><strong>{money(m.amount.total)}</strong></span>
          <span><span className={styles.srOnly}>Annual target: </span>{m.goal?money(m.goal):<span title="No individual target set">Not set<span className={styles.srOnly}> · No individual target set</span></span>}</span>
          <span><span className={styles.srOnly}>Status: </span><span className={styles.statusBadge}>{m.status==="SUSPENDED"?"Suspended":m.status==="ACTIVE"?"Active":m.status}</span></span>
        </summary><div className={styles.memberDetails}><p>Year-to-date completion {percent(m.progress.percent)} · Gap {money(m.progress.gap)}</p><p>{performanceMonth(month)} {data.comparison.future?"Not started":money(m.month.total)} · {m.comparison.complete?"vs previous period":"Subtotal change / Comparison pending"} {money(m.comparison.delta)}({percent(m.comparison.percent)})</p><Composition value={m.amount}/><div className={styles.months}>{m.months.map(mm=><div key={mm.month}><small>{performanceMonth(mm.month)}</small><strong>{mm.future?"Not started":money(mm.amount.total)}</strong>{!mm.future&&!mm.complete&&<small>Attribution / Data incomplete</small>}</div>)}</div><Link href={href({tab:"details",employee:m.id,page:""})}>View branch receipts, refunds and attribution history →</Link></div></details></li>)}</ul>{!data.members.length&&<p>No members, individual targets or contributions for this year. Team receipts are verified independently.</p>}{data.members.length>0&&!visibleMembers.length&&<p>No team members match your search.</p>}
      </section>
    </>}
    {tab==="targets"&&<>{canManage?<TargetEditor key={`${branch.id}:${year}:${data.revision}`} data={data} branchId={branch.id}/>:<section className={styles.card}><h2>Annual targets (read-only)</h2><p>Three cumulative thresholds: {data.target?.levels.map(money).join(" / ")??"Not set"}</p>{data.members.map(m=><p key={m.id}>{m.fullName} · {m.employeeCode}: {m.goal?money(m.goal):"No individual target set"}</p>)}<p>Only authorised target managers can make changes. A manager title or approval permission does not grant access automatically.</p></section>}
      <section className={styles.card}><h2>Publication history (read-only)</h2>{!data.history.length&&<p>No targets published yet.</p>}{data.history.map(h=><details key={h.id}><summary>Version {h.revision} · {h.actorName} · {date(h.createdAt)}</summary><p>Reason: {h.reason}</p><p>Previous thresholds: {(h.previousSnapshot as TargetSnapshot|null)?.levels?.map(money).join(" / ")??"First publication"}</p><p>New thresholds: {(h.snapshot as TargetSnapshot).levels.map(money).join(" / ")}</p><p>Allocation gap {money((h.snapshot as TargetSnapshot).gap)}</p>{(h.snapshot as TargetSnapshot).people.map(m=><p key={m.membershipId}>{m.fullName} · {m.employeeCode} · {m.status}: {money(m.amount)}</p>)}</details>)}</section></>}
    {tab==="details"&&<section className={styles.card}><h2>Receipt and refund events</h2><p>{p.range==="year"?"Full year":"Selected month"} · Verified total {money(p.range==="year"?data.annual.team.total:data.current.team.total)}, unchanged by pagination. Current filter: {data.totalRows} sources.</p>{selectedMember&&<p>{selectedMember.fullName} · {selectedMember.employeeCode} · Annual branch contribution {money(selectedMember.amount.total)} · Annual target {selectedMember.goal?money(selectedMember.goal):"No individual target set"}</p>}
      <form method="get" className={styles.filters}><input name="tab" type="hidden" value="details"/><input name="branch" type="hidden" value={branch.id}/><input name="year" type="hidden" value={year}/><input name="month" type="hidden" value={month}/><label>Employee<select name="employee" defaultValue={p.employee??""}><option value="">All members and unassigned</option><option value="UNASSIGNED">Unassigned</option>{data.members.map(m=><option key={m.id} value={m.id}>{m.fullName} · {m.employeeCode}</option>)}</select></label><label>Detail period<select name="range" defaultValue={p.range??"month"}><option value="month">Selected month</option><option value="year">Year to date</option></select></label><label>Source status<select name="status" defaultValue={p.status??""}><option value="">All statuses</option>{Object.entries(statuses).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>Contribution breakdown<select name="component" defaultValue={p.component??""}><option value="">Sales and tips</option><option value="SALE">Sales</option><option value="TIP">Tips</option></select></label><button type="submit">Filter details</button></form>
      <div className={styles.events}>{data.details.map(s=><details key={s.sourceKey} className={styles.event}><summary><span><strong>{s.invoiceNumber === "无发票" ? "No invoice" : s.invoiceNumber}</strong><small>{date(s.occurredAt)} · {s.method} · {s.sourceKey.startsWith("REFUND:")?"Refund":"Source event"}</small></span><span><small>Team performance from this event</small><strong>{money(s.qualifiedCents)}</strong><small>{statuses[s.classification]??s.classification}</small></span></summary><dl className={styles.composition}><div><dt>Original amount</dt><dd>{money(s.rawCents)}</dd></div><div><dt>Tax</dt><dd>{money(s.taxCents)}</dd></div><div><dt>Sales</dt><dd>{money(s.salesCents)}</dd></div><div><dt>Tips</dt><dd>{money(s.tipCents)}</dd></div></dl><p>Composition: {s.compositionStatus} · Original payment {s.paymentId} · Source {s.sourceKey}</p>{s.issues.length?<p className={styles.warning}>{s.issues.join(" / ")}</p>:null}{s.detail?.allocations.map((a,i)=><p key={i}>{a.membershipId?data.members.find(m=>m.id===a.membershipId)?.fullName??a.membershipId:"Unassigned"} · Sales {money(a.salesReceived)} · Tips {money(a.tipsReceived)} · Refund {money(a.refunds)} · Total {money(a.total)}</p>)}<details><summary>View attribution versions and corrections</summary>{s.attributionHistory.map(a=><div key={a.id}><p>{a.component==="TIP"?"Tips":"Sales"} version {a.revision} · {date(a.createdAt)} · {a.reason}</p><small>Changed by {a.actorUserId} · Tip payment scope {a.paymentId??"Entire order sales"}</small>{a.shares.map((sh,i)=><p key={i}>{sh.employeeName??"Unassigned"} · {sh.employeeCode} · {sh.basisPoints/100}%</p>)}</div>)}</details></details>)}</div>
      {!data.details.length&&<p>No sources match these filters for this period. Other periods may still contain transactions.</p>}<nav className={styles.tools} aria-label="Performance detail pages">{data.page>1&&<Link href={href({page:String(data.page-1)})}>Previous</Link>}<span>Page {data.page} / {Math.max(1,Math.ceil(data.totalRows/data.pageSize))}</span>{data.page*data.pageSize<data.totalRows&&<Link href={href({page:String(data.page+1)})}>Next</Link>}</nav>
    </section>}
  </main>;
}
