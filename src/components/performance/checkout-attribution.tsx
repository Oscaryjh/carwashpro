"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./checkout-attribution.module.css";

type Employee = { id: string; fullName: string; employeeCode: string };
type Share = { membershipId: string; basisPoints: number; fullName?: string; employeeCode?: string };
type Context = { enabled: boolean; employees?: Employee[]; canUnassign?: boolean; error?: string; remainingTipCents?: number;
  saleAttribution?: { revision: number; shares: Share[] } | null };
type Props = { branchId?: string; workOrderId?: string; appointmentId?: string; customerPackageId?: string; hasTip?: boolean; exempt?: boolean; onEnabledChange?: (enabled: boolean) => void };

export function CheckoutAttribution(props: Props) {
  const panel = useRef<HTMLElement>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [query, setQuery] = useState("");
  const [tipQuery, setTipQuery] = useState("");
  const [multiple, setMultiple] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [tip, setTip] = useState("");
  const [unassigned, setUnassigned] = useState(false);
  const [unassignedTip, setUnassignedTip] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [formBranch, setFormBranch] = useState("");
  const previousTarget = useRef<string | null>(null);
  const target = new URLSearchParams(Object.entries({ branchId: props.branchId || formBranch, workOrderId: props.workOrderId, appointmentId: props.appointmentId, customerPackageId: props.customerPackageId }).filter((entry): entry is [string, string] => !!entry[1])).toString();
  useEffect(() => {
    const form = panel.current?.closest("form");
    const update = () => setFormBranch(String(new FormData(form ?? undefined).get("branchId") ?? ""));
    update(); form?.addEventListener("change", update);
    return () => form?.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const changed = previousTarget.current !== target;
    previousTarget.current = target;
    setContext(null);
    if (changed) { setShares([]); setTip(""); setUnassigned(false); setUnassignedTip(false); setReason(""); }
    fetch(`/api/performance/checkout-context?${target}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const data = await response.json() as Context;
      if (!controller.signal.aborted) { setContext(data); if (data.saleAttribution) setShares(data.saleAttribution.shares); }
    }).catch(() => { if (!controller.signal.aborted) setContext({ enabled: true, error: "Unable to load performance employees." }); });
    return () => controller.abort();
  }, [target, reload]);
  const locked = !!context?.saleAttribution;
  const onEnabledChange = props.onEnabledChange;
  useEffect(() => { if (context) onEnabledChange?.(context.enabled); }, [context, onEnabledChange]);
  const needsTip = !props.exempt && (props.hasTip || (context?.remainingTipCents ?? 0) > 0);
  const total = shares.reduce((value, share) => value + share.basisPoints, 0);
  const validation = props.exempt || context?.enabled === false ? "" : !context || context.error ? "Load performance employees before payment." :
    !locked && !unassigned && (!shares.length || total !== 10_000) ? "Select sales employees with a total allocation of 100%." :
    needsTip && !tip && !unassignedTip ? "Select this payment's tip recipient separately." :
    (unassigned || unassignedTip) && reason.trim().length < 5 ? "Give an explicit unassigned reason (at least 5 characters)." : "";
  useEffect(() => {
    const form = panel.current?.closest("form");
    const guard = (event: Event) => {
      if (!validation) return;
      event.preventDefault(); event.stopImmediatePropagation(); setError(validation); panel.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    form?.addEventListener("submit", guard, true);
    return () => form?.removeEventListener("submit", guard, true);
  }, [validation]);
  const employees = context?.employees ?? [];
  const filtered = (q: string) => employees.filter((employee) => `${employee.fullName} ${employee.employeeCode}`.toLowerCase().includes(q.toLowerCase()));
  function choose(employee: Employee) {
    setError("");
    setShares((current) => multiple ? current.some((share) => share.membershipId === employee.id)
      ? current.filter((share) => share.membershipId !== employee.id) : [...current, { membershipId: employee.id, basisPoints: 0 }]
      : [{ membershipId: employee.id, basisPoints: 10_000 }]);
  }
  function equalize() {
    setShares((current) => current.map((share, index) => ({ ...share, basisPoints: Math.floor(10_000 / current.length) + (index < 10_000 % current.length ? 1 : 0) })));
  }
  return <section ref={panel} className={context?.enabled === false || props.exempt ? undefined : styles.panel} aria-label="Performance attribution">
    {context?.enabled === false || props.exempt ? null : <>
      <h3>业绩归属员工 · Sales attribution</h3>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <p className={styles.muted}>Sales and tips count toward performance, not commission or a tip payout.</p>
      {!context ? <p role="status">Loading authorized employees…</p> : context.error ? <><p role="alert" className={styles.error}>{context.error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></> : <>
        <input type="hidden" name="performanceAttribution" value={JSON.stringify({ version: 1, ...(!locked ? { sales: unassigned ? [] : shares.map(({ membershipId, basisPoints }) => ({ membershipId, basisPoints })) } : {}), ...(needsTip ? { tipMembershipId: unassignedTip ? null : tip || null } : {}), ...((unassigned || unassignedTip) ? { unassignedReason: reason } : {}) })} />
        {locked ? <p>Sales attribution retained: {shares.length ? shares.map((share) => `${share.fullName} (${share.employeeCode}) ${share.basisPoints / 100}%`).join(" · ") : "Unassigned (historical order)"}. Paid attribution requires a protected correction.</p> : !unassigned && <>
          <div className={styles.toggle}><button type="button" aria-pressed={!multiple} onClick={() => { setMultiple(false); setShares((value) => value.length ? [{ ...value[0], basisPoints: 10_000 }] : []); }}>One employee</button><button type="button" aria-pressed={multiple} onClick={() => setMultiple(true)}>Multiple employees</button></div>
          <label>Search name or employee code<input value={query} onChange={(event) => setQuery(event.target.value)} type="search" autoComplete="off" /></label>
          <div className={styles.choices}>{filtered(query).map((employee) => <button type="button" key={employee.id} aria-pressed={shares.some((share) => share.membershipId === employee.id)} onClick={() => choose(employee)}>{employee.fullName} · {employee.employeeCode}</button>)}</div>
          {!filtered(query).length && <p>No eligible employees in this branch.</p>}
          {multiple && <><button type="button" disabled={!shares.length} onClick={equalize}>Split equally</button>{shares.map((share) => <div className={styles.row} key={share.membershipId}>
            <span>{employees.find((employee) => employee.id === share.membershipId)?.fullName}<br /><small>{employees.find((employee) => employee.id === share.membershipId)?.employeeCode} · Sales %</small></span>
            <input aria-label={`Sales percent ${employees.find((employee) => employee.id === share.membershipId)?.employeeCode}`} type="number" min="0.01" max="100" step="0.01" inputMode="decimal" value={share.basisPoints / 100} onChange={(event) => setShares((current) => current.map((item) => item.membershipId === share.membershipId ? { ...item, basisPoints: Math.round(Number(event.target.value) * 100) } : item))} />
            <button aria-label="Remove sales recipient" type="button" onClick={() => setShares((current) => current.filter((item) => item.membershipId !== share.membershipId))}>×</button>
          </div>)}<p aria-live="polite">Allocated {total / 100}% · {total > 10_000 ? "Over" : "Remaining"} {Math.abs(10_000 - total) / 100}%</p></>}
        </>}
        {needsTip && <><h3>小费归属员工 · Tip recipient</h3><p className={styles.muted}>One recipient for the tip actually received in this payment. Independent from sales.</p>
          <label>Search tip recipient<input type="search" value={tipQuery} onChange={(event) => setTipQuery(event.target.value)} autoComplete="off" /></label>
          <div className={styles.choices}>{filtered(tipQuery).map((employee) => <button type="button" key={employee.id} aria-pressed={tip === employee.id} onClick={() => { setTip(employee.id); setError(""); }}>{employee.fullName} · {employee.employeeCode}</button>)}</div>
        </>}
        {context.canUnassign && <>{!locked && <label className={styles.check}><input type="checkbox" checked={unassigned} onChange={(event) => setUnassigned(event.target.checked)} />Leave sales unassigned (authorized exception)</label>}{needsTip && <label className={styles.check}><input type="checkbox" checked={unassignedTip} onChange={(event) => setUnassignedTip(event.target.checked)} />Leave tip unassigned (authorized exception)</label>}{(unassigned || unassignedTip) && <label>Unassigned reason<textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} /></label>}</>}
      </>}
    </>}
  </section>;
}
