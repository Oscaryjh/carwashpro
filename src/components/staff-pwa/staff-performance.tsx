"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StaffPerformanceDTO } from "@/lib/staff-pwa/performance";
import { staffApiFetch, StaffApiError } from "@/lib/staff-pwa/client";
import { formatPerformanceMoney as money, formatPerformancePercent as percentage, formatRefund, monthNames as months, monthlyChartGeometry, shortPeriod } from "./staff-performance-display";
import styles from "./staff-performance.module.css";

type Summary = StaffPerformanceDTO["personal"];
type Amount = Summary["annual"];
const date = (v: string, timezone: string, seconds = false) => new Intl.DateTimeFormat("en-GB", { timeZone: timezone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" as const } : {}) }).format(new Date(v));
const roundMoney = (v: number) => `RM${new Intl.NumberFormat("en-MY", { minimumFractionDigits: v % 100 ? 2 : 0, maximumFractionDigits: v % 100 ? 2 : 0 }).format(v / 100)}`;
const axisMoney = (v: number) => `${v < 0 ? "−" : ""}RM${new Intl.NumberFormat("en-MY", { notation: "compact", maximumFractionDigits: 1 }).format(Math.abs(v) / 100)}`;
type Detail = NonNullable<StaffPerformanceDTO["detail"]>;

function Progress({ summary }: { summary: Summary }) {
  if (!summary.goal) return null;
  return <div className={styles.progress}>
    {summary.progress.percent !== null && <div className={styles.track} role="img" aria-label={`${percentage(summary.progress.percent)} of annual target achieved`}><span style={{ width: `${Math.min(100, Math.max(0, summary.progress.percent))}%` }} /></div>}
    <small>{!summary.goal ? "Annual target not set" : summary.progress.percent === null ? "Progress awaiting review" :
      `${percentage(summary.progress.percent)} achieved · ${summary.progress.gap === 0 ? "Target reached" : summary.progress.gap! < 0 ? `${money(Math.abs(summary.progress.gap!))} above target` : `${money(summary.progress.gap!)} to target`}`}</small>
  </div>;
}
function Composition({ amount }: { amount: Amount }) {
  return <dl className={styles.composition}><div><dt>Sales</dt><dd>{money(amount.salesReceived)}</dd></div><div><dt>Tips</dt><dd>{money(amount.tipsReceived)}</dd></div>
    <div><dt>Refunds</dt><dd>{formatRefund(amount.refunds)}</dd></div></dl>;
}
function Comparison({ summary, timezone, compact = false }: { summary: Summary; timezone: string; compact?: boolean }) {
  const c = summary.comparison;
  if (c.future) return <small>Not started</small>;
  const direction = c.delta < 0 ? "Down" : c.delta > 0 ? "Up" : "No change";
  if (compact) return <small className={styles.comparison}>{!c.complete ? "Comparison awaiting review" : c.percent === null ? "Percentage comparison unavailable" : `${c.delta < 0 ? "↓" : c.delta > 0 ? "↑" : "→"} ${percentage(Math.abs(c.percent))} vs ${c.ongoing ? "last month to date" : "previous full month"}`}</small>;
  return <div className={styles.comparison}>
    <strong>{!c.complete ? "Comparison awaiting review" : c.delta === 0 ? direction : `${direction} ${money(Math.abs(c.delta))}${c.percent === null ? "" : ` (${percentage(Math.abs(c.percent))})`}`}</strong>
    <small>vs {shortPeriod(c.previousFrom, c.previousTo, timezone)}{c.ongoing ? " · same period" : " · full month"}</small>
    {!c.complete && <p className={styles.notice}>Some data is still being checked. Subtotal difference: {money(c.delta)}; change is not yet confirmed.</p>}
    {c.percent === null && c.complete && <small>Percentage unavailable: the previous period was zero or negative.</small>}
  </div>;
}
function TeamLevel({ data, lineOnly = false, milestones = false }: { data: StaffPerformanceDTO; lineOnly?: boolean; milestones?: boolean }) {
  const team = data.team;
  const confirmed = team.started && team.complete && team.level !== null && !!team.levels;
  const threshold = team.levels?.[Math.min(team.level ?? 0, 2)];
  const label = !team.started ? "Not started" : !team.complete ? "Level awaiting review" : !team.levels ? "Team targets not set" : team.level === 3 ? "All levels achieved" : `${team.level ? `Level ${team.level} reached` : "Working toward Level 1"} · Next ${roundMoney(threshold!)}`;
  return <div className={styles.level}><strong>{lineOnly ? "Team: " : ""}{label}</strong>
    {!lineOnly && confirmed && threshold && <><div className={styles.track} role="img" aria-label={`Team progress toward cumulative ${money(threshold)}`}><span style={{width:`${Math.max(0, Math.min(100, team.annual.total / threshold * 100))}%`}} /></div>
      {team.level !== 3 && <small>{money(team.nextGap!)} to Level {team.level! + 1} · cumulative target</small>}</>}
    {milestones && team.levels && <><ol className={styles.milestones}>{team.levels.map((v, i) => <li key={i} data-reached={confirmed && team.level! > i}><span>Level {i + 1}</span><b>{roundMoney(v)}</b><small>{!confirmed ? "Not confirmed" : team.level! > i ? "Reached" : "Not reached"}</small></li>)}</ol><small>Annual cumulative thresholds, not separate targets.</small></>}
  </div>;
}

function MonthlyChart({ values, selected, onSelect }: { values: Detail["months"]; selected: number; onSelect: (month: number) => void }) {
  const chart = monthlyChartGeometry(values);
  return <>
    <figure className={styles.chart} aria-label="Monthly performance, with a shared amount scale">
      <svg viewBox="0 0 360 180" role="img" aria-label="Monthly performance chart. Exact amounts and statuses are available in View monthly figures.">
        <text x="0" y="12" className={styles.axis}>{axisMoney(chart.max)}</text>
        <line x1="46" x2="356" y1={chart.zero + 14} y2={chart.zero + 14} className={styles.zeroLine} />
        {chart.min < 0 && <text x="0" y="156" className={styles.axis}>{axisMoney(chart.min)}</text>}
        {chart.points.map((p, i) => <g key={p.month} onClick={() => onSelect(p.month)} className={styles.chartPoint}>
          <title>{months[i]}: {p.status === "future" ? "Not started" : p.status === "pending" ? "Awaiting review" : money(p.value!)}</title>
          {p.status === "complete" ? <rect data-month={p.month} x={49 + i * 25.5} y={p.y + 14} width="17" height={p.height} rx="2" fill={p.month === selected ? "#078b80" : "#85b9b2"} /> : <text x={57 + i * 25.5} y={chart.zero + 10} textAnchor="middle" className={p.status === "pending" ? styles.pendingMarker : styles.axis}>{p.status === "pending" ? "?" : "–"}</text>}
          <text x={57 + i * 25.5} y="176" textAnchor="middle" className={styles.axis}>{months[i].slice(0, 1)}</text>
        </g>)}
      </svg>
      <figcaption>One shared scale · ? Awaiting review · – Not started</figcaption>
    </figure>
    <div className={styles.monthPicker} aria-label="Choose chart month">{values.map(m => <button type="button" key={m.month} aria-label={`Select ${months[m.month - 1]}${m.future ? ", not started" : !m.complete ? ", awaiting review" : ""}`} aria-pressed={m.month === selected} onClick={() => onSelect(m.month)}>{months[m.month - 1]}</button>)}</div>
    <details className={styles.disclosure}><summary>View monthly figures</summary><table className={styles.figures}><thead><tr><th>Month</th><th>Performance</th><th>Status</th></tr></thead><tbody>{values.map(m => <tr key={m.month}><th scope="row"><button type="button" onClick={() => onSelect(m.month)}>{months[m.month - 1]}</button></th><td>{m.future ? "—" : money(m.amount.total)}</td><td>{m.future ? "Not started" : m.complete ? "Checked" : "Verified subtotal"}</td></tr>)}</tbody></table></details>
  </>;
}

function SummaryWarnings({ summary, personal }: { summary: Summary; personal: boolean }) {
  return <>{!summary.started ? <p className={styles.notice}>This year has not started.</p> : !summary.complete && <p className={styles.notice}>Data is still being checked. This is a verified subtotal; achievement is not yet confirmed.</p>}
    {personal && !summary.attributionComplete && <p className={styles.notice}>Some sales or tips are still unassigned. Your confirmed contributions are shown; progress is awaiting review.</p>}</>;
}

export function StaffPerformance({ scopeKey, card = false }: { scopeKey: string; card?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const onRoute = pathname === (card ? "/staff" : "/staff/performance");
  const [data, setData] = useState<StaffPerformanceDTO | null>(null);
  const [error, setError] = useState("");
  const [disabled, setDisabled] = useState(false);
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState({ view: card ? "card" : "auto", year: "", month: "", page: 1, member: "", search: "" });
  const request = useRef<AbortController | null>(null);
  const active = useRef(true);
  const lastStart = useRef(0);
  const load = useCallback(async (force = false) => {
    if (!force && (request.current || Date.now() - lastStart.current < 1500)) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller; lastStart.current = Date.now();
    setData(null); setError("");
    if (!navigator.onLine) { setError("Offline · Cannot update performance. No cached personal data is shown."); request.current = null; return; }
    const params = new URLSearchParams({ view: query.view, page: String(query.page) });
    for (const k of ["year", "month", "member", "search"] as const) if (query[k]) params.set(k, query[k]);
    try {
      const result = await staffApiFetch<StaffPerformanceDTO>(`/api/employee-performance?${params}`, { signal: controller.signal });
      if (controller.signal.aborted || !active.current) return;
      if (result.scopeKey !== scopeKey) { setError("Workplace changed. Reloading your current scope…"); router.refresh(); return; }
      setData(result); setLastSeen(result.asOf); setDisabled(false);
    } catch (e) {
      if (controller.signal.aborted || !active.current) return;
      if (e instanceof StaffApiError && e.status === 404) setDisabled(true);
      else {
        setError(e instanceof Error ? e.message : "Performance could not be updated.");
        if (e instanceof StaffApiError && e.status === 401) router.replace("/staff/login");
      }
    } finally { if (request.current === controller) request.current = null; }
  }, [query, router, scopeKey]);
  useEffect(() => {
    if (!onRoute) { active.current = false; return; }
    active.current = true; void load(true);
    const clear = () => { request.current?.abort(); request.current = null; setData(null); };
    const visibility = () => { if (document.hidden) clear(); else void load(true); };
    const foreground = () => { if (!document.hidden) void load(); };
    const contextChange = () => { clear(); setLastSeen(null); setError("Account or workplace changed. Please reopen performance."); };
    const offline = () => { clear(); setError("Offline · Cannot update performance. Reconnect to refresh."); };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tetamu-staff-context") : null;
    if (channel) channel.onmessage = contextChange;
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", foreground); window.addEventListener("pageshow", foreground);
    window.addEventListener("online", foreground); window.addEventListener("offline", offline);
    window.addEventListener("tetamu:staff-context-changing", contextChange);
    return () => { active.current = false; request.current?.abort(); request.current = null; channel?.close(); setData(null);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("focus", foreground);
      window.removeEventListener("pageshow", foreground); window.removeEventListener("online", foreground); window.removeEventListener("offline", offline);
      window.removeEventListener("tetamu:staff-context-changing", contextChange); };
  }, [load, onRoute]);
  const change = (patch: Partial<typeof query>) => { setData(null); setQuery(q => ({ ...q, ...patch, page: patch.page ?? 1 })); };
  if (!onRoute) return null;
  if (disabled) return card ? null : <section className={styles.panel}>Performance is not enabled. <Link href="/staff">Home</Link></section>;
  if (!data) return <section className={`${styles.scope} ${styles.panel}`} data-testid="staff-performance" aria-live="polite" aria-busy={!error}>
    {!card && <Link href="/staff">‹ Home</Link>}<div className={styles.title}><strong>Performance</strong>{!error && <button type="button" disabled aria-label="Refreshing performance">↻</button>}</div><p>{error || "Updating performance…"}</p>{lastSeen && <small>Last updated: {new Date(lastSeen).toLocaleString("en-GB")}</small>}
    {error && <button type="button" onClick={() => void load(true)}>Retry performance</button>}</section>;
  const manager = data.canViewTeam;
  if (card) {
    const s = manager ? data.team : data.personal;
    return <section className={`${styles.scope} ${styles.card}`} data-testid="staff-performance">
      <Link href="/staff/performance" prefetch={false} className={styles.cardLink}>
        <div className={styles.title}><h2>{manager ? "Team Performance" : "My Performance"}</h2><span className={styles.cardYear}>{data.year}<span aria-label="View details"> ›</span></span></div>
        <div className={styles.headAmount}><strong>{money(s.annual.total)}</strong><small>{!s.complete ? "Verified subtotal · Data incomplete" : manager ? data.branchName : "Year to date"}</small></div>
        {manager ? <TeamLevel data={data} /> : <><small>Annual target {s.goal ? money(s.goal) : "not set"}{data.personalBranchCount > 1 ? ` · ${data.personalBranchCount} branches` : ""}</small><Progress summary={s} /></>}
        {!manager && !s.attributionComplete && <small className={styles.inlineWarning}>Some contributions are still unassigned.</small>}
        <div className={styles.monthLine}><span>This month <b>{money(s.current.total)}</b></span><Comparison summary={s} timezone={data.timezone} compact /></div>
        {manager ? <small className={styles.personalLine}>My year {money(data.personal.annual.total)} · Target {data.personal.goal ? money(data.personal.goal) : "not set"}{!data.personal.complete || !data.personal.attributionComplete ? " · awaiting review" : ""}</small> : <TeamLevel data={data} lineOnly />}
      </Link>
    </section>;
  }
  const detail = data.detail!;
  const subject = detail.subject;
  const teamView = data.mode === "team";
  const scopeLabel = data.mode === "mine" ? detail.branches.length === 1 ? detail.branches[0].name : `All your branches · ${data.personalBranchCount} branches` : data.branchName;
  const selectedMonthName = new Intl.DateTimeFormat("en-GB", { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(data.year, data.month - 1, 1)));
  const pages = Math.ceil(detail.totalRows / detail.pageSize);
  return <div className={styles.scope} data-testid="staff-performance">
    <header className={styles.detailHeader}><Link href="/staff" className={styles.homeLink}>‹ Home</Link><div className={styles.title}><h1>Performance</h1><div className={styles.headerActions}>
      <select aria-label="Performance year" value={query.year || data.year} onChange={e => change({ year: e.target.value })}>{Array.from({length:200},(_,i)=>2200-i).map(y=><option key={y} value={y}>{y}</option>)}</select>
      <button type="button" aria-label="Refresh performance" title="Refresh performance" onClick={() => void load(true)}>↻</button></div></div></header>
    <nav className={styles.tabs} aria-label="Performance views"><button aria-pressed={data.mode === "mine"} onClick={() => change({ view: "mine", member: "", search: "" })}>My performance</button><button aria-pressed={data.mode === "team" || data.mode === "member"} onClick={() => change({ view: "team", member: "" })}>Team performance</button></nav>
    {data.mode === "member" && <button className={styles.backToTeam} onClick={() => change({ view: "team", member: "" })}>‹ Back to team members</button>}
    <div className={styles.overviewGrid}>
      <section className={`${styles.panel} ${styles.annual}`} aria-label="Annual performance">
        <h2>{teamView ? "Team performance" : detail.selectedIdentity?.fullName ?? "My performance"}</h2>
        <small>{scopeLabel}{detail.selectedIdentity ? ` · ${detail.selectedIdentity.employeeCode}` : ""}</small>
        <div className={styles.annualAmount}><span>{subject.complete ? "Year to date" : "Verified subtotal"} · {data.year}</span><strong>{!subject.started ? "Not started" : money(subject.annual.total)}</strong></div>
        <SummaryWarnings summary={subject} personal={!teamView} />
        {teamView ? <TeamLevel data={data} milestones /> : <><p className={styles.targetLine}>{subject.goal ? <>Annual target <b>{money(subject.goal)}</b></> : "Annual target not set"}</p><Progress summary={subject} /></>}
        <details className={styles.disclosure}><summary>View breakdown</summary><Composition amount={subject.annual} /></details>
        {teamView && <p className={styles.unassigned}>Unassigned <b>{money(data.team.unassigned.total)}</b> · Included in team performance.</p>}
        {data.mode === "mine" && detail.branches.length > 1 && <details className={styles.disclosure}><summary>View by branch</summary>{detail.branches.map((b, i) => <div className={styles.row} key={i}><strong>{b.name}</strong><span>{money(b.amount.total)}</span><small>Annual target {b.goal ? money(b.goal) : "not set"} · {b.complete ? "Checked" : "Data incomplete"}{!b.attributionComplete ? " · Assignments pending" : ""}</small></div>)}</details>}
      </section>
      <section className={`${styles.panel} ${styles.monthly}`} aria-label="Monthly performance"><div className={styles.title}><h2>Monthly performance</h2><select aria-label="Performance month" value={query.month || data.month} onChange={e => change({ month: e.target.value })}>{months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></div>
        <div className={styles.monthSummary}><span>{selectedMonthName} {data.year}</span><strong className={styles.monthAmount}>{subject.comparison.future ? "Not started" : money(subject.current.total)}</strong><Comparison summary={subject} timezone={data.timezone} /></div>
        <MonthlyChart values={detail.months} selected={data.month} onSelect={month => change({ month: String(month) })} />
        <details className={styles.disclosure}><summary>Period details</summary><small>{subject.comparison.future ? "This month has not started." : <>{date(subject.comparison.from, data.timezone, true)} – {date(subject.comparison.to, data.timezone, true)}<br />Compared with {date(subject.comparison.previousFrom, data.timezone, true)} – {date(subject.comparison.previousTo, data.timezone, true)}</>}<br />Operating timezone: {data.timezone}. Checked {date(data.asOf, data.timezone, true)}.</small></details>
      </section>
    </div>
    {teamView && manager && <section className={styles.panel}><h2>Members · this branch</h2><form className={styles.memberSearch} onSubmit={e=>{e.preventDefault();change({search:searchText});}}><label>Search name or employee number<input type="search" value={searchText} onChange={e => setSearchText(e.target.value)} /></label><button type="submit">Search members</button></form>
      {!detail.members.length && <p>No matching members.</p>}{detail.members.map(m => <details className={`${styles.row} ${styles.member}`} key={m.id}><summary><div className={styles.memberMain}><div><strong>{m.fullName}</strong><small>{m.employeeCode} · {m.status}</small></div><b>{money(m.summary.annual.total)}</b></div><small>Annual target {m.summary.goal ? money(m.summary.goal) : "not set"}</small><Progress summary={m.summary} /></summary>
        <SummaryWarnings summary={m.summary} personal /><Composition amount={m.summary.annual} />
        <button onClick={() => change({ view: "member", member: m.id })}>View months & details</button></details>)}</section>}
    {!teamView && <section className={styles.panel} aria-label="Transactions"><h2>Transactions</h2><small>{data.mode === "member" ? "This member’s sales and tips, after refunds. Tax excluded." : "Your sales and tips, after refunds. Tax excluded."}</small>
      {!detail.events.length && <p className={styles.empty}>{subject.comparison.future ? "This month has not started." : "No contributions recorded for this month."}</p>}
      {detail.events.map(e => <details className={`${styles.row} ${styles.transaction}`} key={e.id}><summary><div className={styles.transactionLabel}><strong>{e.kind === "REFUND" ? "Refund" : e.amount?.salesReceived && e.amount?.tipsReceived ? "Sales & tip" : e.amount?.tipsReceived ? "Tip" : "Sales payment"}</strong><span className={styles.orderNumber} title={e.orderNumber ?? undefined}>{e.orderNumber || "No invoice"}</span><small>{date(e.occurredAt, data.timezone)}{detail.branches.length > 1 ? ` · ${e.branchName}` : ""}</small></div><b>{e.amount ? money(e.amount.total) : "Awaiting review"}</b></summary>{e.amount ? <><Composition amount={e.amount} />{e.kind === "REFUND" && <small>Reversal of your contribution from the original payment.</small>}<small className={styles.fullOrder}>Order: {e.orderNumber || "No invoice"}</small></> : <p className={styles.notice}>This transaction is being reviewed. The contribution amount is not yet confirmed.</p>}</details>)}
      {!!detail.totalRows && <small className={styles.rowCount}>{detail.totalRows} contribution {detail.totalRows === 1 ? "transaction" : "transactions"} in {selectedMonthName}</small>}
      {pages > 1 && <div className={styles.pagination}><button disabled={detail.page <= 1} onClick={() => change({ page: detail.page - 1 })}>Previous</button><span>{detail.page} of {pages}</span><button disabled={detail.page * detail.pageSize >= detail.totalRows} onClick={() => change({ page: detail.page + 1 })}>Next</button></div>}
    </section>}
    <footer className={styles.footer}><small>Updated {date(data.asOf, data.timezone)}</small><details className={styles.disclosure}><summary>How performance is calculated</summary><p>Sales received + tips received − refunds. Tax is excluded. Progress does not mean commission, wages or tips have been paid.</p><p>Annual targets cover the full natural year. Team levels are cumulative; personal targets have no levels.</p><p>Operating timezone: {data.timezone}. Coverage: {date(data.periodStart, data.timezone, true)} through {date(data.asOf, data.timezone, true)}.</p><p>{subject.complete ? "Sources checked for this period." : "Some sources are missing or awaiting review."}{!teamView && !subject.attributionComplete ? " Some contributions are still unassigned." : ""}</p></details></footer>
  </div>;
}
