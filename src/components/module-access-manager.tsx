"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { changedModules, effectiveModuleKeys, moduleAccessCounts, proposeModuleEdit, shouldPreserveModuleDraft, type ModuleAccessRow } from "./module-access-state";
import styles from "./module-access-manager.module.css";

type Props = {
  businessId: string;
  initialRows: ModuleAccessRow[];
  evaluatedAt: string;
  action: (formData: FormData) => Promise<void>;
  result: { type?: string; message?: string };
  embedded?: boolean;
};
const categories = { CORE: "Core", OPERATIONS: "Operations", WORKFORCE: "Workforce", ADD_ON: "Add-on", FUTURE: "Future" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(value));
const dateInput = (value: string) => value.slice(0, 16);
const dateValue = (value: string) => value ? new Date(`${value}:00Z`).toISOString() : "";

export function ModuleAccessManager({ businessId, initialRows, evaluatedAt, action, result, embedded = false }: Props) {
  const [baseline, setBaseline] = useState(initialRows);
  const [rows, setRows] = useState(initialRows);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ModuleAccessRow | null>(null);
  const [proposal, setProposal] = useState<ReturnType<typeof proposeModuleEdit> | null>(null);
  const [confirmed, setConfirmed] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const storageKey = `tetamu:module-access-draft:${businessId}`;
  const initialSignature = JSON.stringify(initialRows);
  const currentDraft = useRef({ baseline, rows });
  currentDraft.current = { baseline, rows };
  const submitted = useRef(false);

  useEffect(() => {
    const fresh = JSON.parse(initialSignature) as ModuleAccessRow[];
    // Saving a different workspace section must not erase unsaved module edits.
    if (shouldPreserveModuleDraft(currentDraft.current.baseline, currentDraft.current.rows, submitted.current)) return;
    setBaseline(fresh);
    setRows(fresh);
    submitted.current = false;
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved && result.type === "error") {
        const draft = JSON.parse(saved) as { baseline: ModuleAccessRow[]; rows: ModuleAccessRow[]; note: string };
        if (Array.isArray(draft.rows) && draft.rows.length === fresh.length && draft.rows.every((row, index) => row.key === fresh[index].key) && Array.isArray(draft.baseline)) {
          setBaseline(draft.baseline); setRows(draft.rows); setNote(draft.note); setOpen(true);
          setError("Your changes are still here. Review the save error and try again, or discard to reload the latest settings.");
        }
      } else if (saved && result.type === "success") {
        sessionStorage.removeItem(storageKey); setNote(""); setError(""); setOpen(true);
        if (!embedded) setNotice(result.message ?? "Module access saved.");
      }
    } catch { /* Storage may be unavailable; live component state is retained. */ }
  }, [initialSignature, storageKey, result.type, result.message, embedded]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);

  useEffect(() => {
    if (editing && !dialog.current?.open) dialog.current?.showModal();
    if (!editing && dialog.current?.open) dialog.current.close();
  }, [editing]);

  const changes = changedModules(baseline, rows);
  const counts = moduleAccessCounts(rows);
  const effective = effectiveModuleKeys(rows, Date.parse(evaluatedAt));
  function closeEditor() { setEditing(null); setProposal(null); }
  function edit(row: ModuleAccessRow) { setEditing({ ...row }); setProposal(null); setError(""); setNotice(""); }
  function apply(row: ModuleAccessRow) {
    const next = proposeModuleEdit(rows, row);
    if (next.error) { setError(next.error); return; }
    if (next.dependencies.length) { setEditing(row); setProposal(next); setConfirmed(true); return; }
    setRows(next.rows); setError(""); closeEditor();
  }
  function toggle(row: ModuleAccessRow) {
    const enabling = row.status !== "ENABLED";
    const expired = row.until !== null && Date.parse(row.until) <= Date.now();
    if (enabling && expired) { edit({ ...row, status: "ENABLED" }); return; }
    apply({ ...row, status: enabling ? "ENABLED" : "DISABLED" });
  }
  function discard() {
    setBaseline(initialRows); setRows(initialRows); setNote(""); setError(""); closeEditor();
    setNotice("Unsaved changes discarded.");
    try { sessionStorage.removeItem(storageKey); } catch { /* no persisted draft */ }
  }

  const Container = embedded ? "section" : "details";
  const Heading = embedded ? "header" : "summary";
  return (
    <Container className={`${styles.section} ${embedded ? styles.embedded : ""}`} open={embedded ? undefined : open} onToggle={(event) => { if (event.currentTarget instanceof HTMLDetailsElement) setOpen(event.currentTarget.open); }}>
      <Heading className={styles.heading}>
        <span><strong>Modules &amp; access</strong><small>Choose which product areas this business can use.</small></span>
        <span className={styles.counts}>{counts.enabled} Enabled · {counts.disabled} Disabled · {counts.total} Total</span>
        {!embedded && <span className={styles.chevron} aria-hidden="true">{open ? "−" : "+"}</span>}
      </Heading>
      <form action={action} onSubmit={() => {
        submitted.current = true;
        setNotice("");
        try { sessionStorage.setItem(storageKey, JSON.stringify({ baseline, rows, note })); } catch { /* browser storage disabled */ }
      }}>
        <input type="hidden" name="businessId" value={businessId} />
        {changes.map((row) => <span key={row.key} hidden>
          <input type="hidden" name="moduleKey" value={row.key} />
          <input type="hidden" name={`expectedRevision:${row.key}`} value={row.revision ?? ""} />
          <input type="hidden" name={`status:${row.key}`} value={row.status} />
          <input type="hidden" name={`enabledFrom:${row.key}`} value={row.from} />
          <input type="hidden" name={`enabledUntil:${row.key}`} value={row.until ?? ""} />
          <input type="hidden" name={`planCode:${row.key}`} value={row.plan} />
        </span>)}
        <PendingControls>
          <p className={styles.legend}>Counts reflect configured status, including required Core. Schedules use UTC; future and expired access are labelled below.</p>
          {notice && <p className={styles.notice} role="status">{notice}</p>}
          {(error || (result.type === "error" && result.message)) && <p className={styles.error} role="alert">{error} {result.type === "error" ? result.message : ""}</p>}
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Module</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Schedule · UTC</th><th scope="col">Dependency</th><th scope="col">Plan</th><th scope="col"><span className="sr-only">Edit</span></th></tr></thead>
              <tbody>{rows.map((row) => {
                const definition = MODULE_REGISTRY[row.key];
                const dirty = changes.some((change) => change.key === row.key);
                const scheduled = Date.parse(row.from) > Date.parse(evaluatedAt);
                const expired = row.until !== null && Date.parse(row.until) <= Date.parse(evaluatedAt);
                return <tr key={row.key} className={dirty ? styles.changed : undefined}>
                  <th scope="row"><span className={styles.moduleName}>{definition.isCore && <svg aria-hidden="true" width="13" height="14" viewBox="0 0 16 18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="8" width="12" height="8" rx="2" /><path d="M5 8V5a3 3 0 0 1 6 0v3" /></svg>}{definition.label}{dirty && <span className={styles.dot} title="Unsaved change" aria-label="Unsaved change" />}</span><small>{row.key}</small>{row.key === "WALLET" ? <small>Enable customer wallet top-ups, payments, refunds and wallet history.</small> : null}</th>
                  <td className={styles.muted}>{categories[definition.category]}</td>
                  <td>{definition.isCore ? <span className={styles.required}>Required</span> : <button type="button" role="switch" aria-checked={row.status === "ENABLED"} aria-label={`${definition.label} access`} className={styles.switch} onClick={() => toggle(row)}><span className={styles.track} aria-hidden="true" /><span>{row.status === "ENABLED" ? "Enabled" : "Disabled"}</span></button>}</td>
                  <td>{definition.isCore ? "Always enabled" : row.status === "DISABLED" ? <span className={styles.muted}>—</span> : <><span>From {dateLabel(row.from)}</span><small>{row.until ? `Until ${dateLabel(row.until)}` : "No expiry"}{scheduled ? " · Scheduled" : expired ? " · Expired" : !effective.has(row.key) ? " · Dependency inactive" : ""}</small></>}</td>
                  <td className={styles.muted}>{definition.dependencies.length ? `Requires ${definition.dependencies.map((key) => MODULE_REGISTRY[key].label).join(", ")}` : "—"}</td>
                  <td className={styles.plan} title={row.plan || undefined}>{row.plan || "—"}</td>
                  <td>{!definition.isCore && <button type="button" className={styles.edit} aria-label={`Edit ${definition.label}`} onClick={() => edit(row)}>Edit</button>}</td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </PendingControls>
        {changes.length > 0 && <SaveBar count={changes.length} note={note} setNote={setNote} discard={discard} />}
      </form>
      <dialog ref={dialog} className={styles.drawer} aria-labelledby="module-editor-title" onCancel={closeEditor} onClick={(event) => { if (event.target === event.currentTarget) closeEditor(); }}>
        {editing && <form onSubmit={(event) => { event.preventDefault(); apply(editing); }} className={styles.drawerForm}>
          <header><div><p>Edit module</p><h2 id="module-editor-title">{MODULE_REGISTRY[editing.key].label}</h2></div><button type="button" className={styles.edit} aria-label="Close module editor" onClick={closeEditor}>×</button></header>
          <div className={styles.drawerBody}>
            <p className={styles.muted}>Apply adds pending changes. Save changes commits the batch.</p>
            {error && <p className={styles.error} role="alert">{error}</p>}
            {proposal ? <section className={styles.confirmation} aria-label="Confirm module dependencies">
              <h3>Update required modules?</h3>
              <p>{MODULE_REGISTRY[editing.key].label} needs these modules for its full schedule:</p>
              <ul>{proposal.dependencies.map((key) => { const row = proposal.rows.find((item) => item.key === key)!; return <li key={key}><strong>{MODULE_REGISTRY[key].label}</strong><small>Enabled from {dateLabel(row.from)} · {row.until ? `Until ${dateLabel(row.until)}` : "No expiry"}</small></li>; })}</ul>
              <label className={styles.checkbox}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Enable required modules and use the schedules shown above</label>
            </section> : <>
              <label>Status<select value={editing.status} onChange={(event) => setEditing({ ...editing, status: event.target.value as ModuleAccessRow["status"] })}><option value="ENABLED">Enabled</option><option value="DISABLED">Disabled</option></select></label>
              {editing.status === "ENABLED" ? <>
                <label>Enabled from · UTC<input type="datetime-local" required value={dateInput(editing.from)} onChange={(event) => setEditing({ ...editing, from: dateValue(event.target.value) })} /></label>
                <label>Expiry<select value={editing.until === null ? "none" : "date"} onChange={(event) => setEditing({ ...editing, until: event.target.value === "none" ? null : new Date(Math.max(Date.parse(editing.from) || Date.now(), Date.now()) + 86400000).toISOString() })}><option value="none">No expiry</option><option value="date">Set end date</option></select></label>
                {editing.until !== null && <label>Enabled until · UTC<input type="datetime-local" required value={dateInput(editing.until)} onChange={(event) => setEditing({ ...editing, until: dateValue(event.target.value) })} /></label>}
              </> : <p className={styles.muted}>Schedule: —. Existing dates are retained but do not grant access while disabled.</p>}
              <label>Plan reference <small>Optional</small><input value={editing.plan} maxLength={80} onChange={(event) => setEditing({ ...editing, plan: event.target.value })} placeholder="No plan reference" /></label>
              <p className={styles.muted}>{editing.source ? `Source: ${editing.source} · Revision ${editing.revision}` : "No saved access record."}</p>
            </>}
          </div>
          <footer><button type="button" className={styles.secondary} onClick={closeEditor}>Cancel</button>{proposal ? <button type="button" className={styles.primary} disabled={!confirmed} onClick={() => { setRows(proposal.rows); setError(""); closeEditor(); }}>Apply with dependencies</button> : <button className={styles.primary} type="submit">Apply</button>}</footer>
        </form>}
      </dialog>
    </Container>
  );
}

function PendingControls({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <fieldset className={styles.controls} disabled={pending}>{children}</fieldset>;
}
function SaveBar({ count, note, setNote, discard }: { count: number; note: string; setNote: (value: string) => void; discard: () => void }) {
  const { pending } = useFormStatus();
  return <div className={styles.saveBar}>
    <strong aria-live="polite">{count} unsaved {count === 1 ? "change" : "changes"}</strong>
    <label>Change note <span>(optional)</span><input name="reason" value={note} onChange={(event) => setNote(event.target.value)} minLength={3} maxLength={500} placeholder="Add a note for this update" disabled={pending} /></label>
    <button type="button" className={styles.secondary} onClick={discard} disabled={pending}>Discard changes</button>
    <button type="submit" className={styles.primary} disabled={pending}>{pending ? "Saving…" : "Save changes"}</button>
  </div>;
}
