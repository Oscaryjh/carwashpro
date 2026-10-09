"use client";
import { useContext, useEffect, useRef, useState, useTransition } from "react";
import { walletPanelAction, walletHistoryAction } from "@/app/(business)/crm/wallet/actions";
import { WalletSummaryView, WalletHistoryRow, type WalletPanel } from "./wallet-views";
import { WalletTopUpModal } from "./wallet-top-up-modal";
import { WalletDialog } from "./wallet-dialog";
import { WalletRefundForm } from "./wallet-refund-form";
import { WalletPanelContext } from "./wallet-panel-context";
import "./wallet.css";

type History = Extract<Awaited<ReturnType<typeof walletHistoryAction>>, { ok: true }>["data"];
export function MemberWalletSummary({ customerId, customerName, entry = "customer", enabled = false, compact = false }: { customerId: string; customerName: string; entry?: "customer" | "cashier"; enabled?: boolean; compact?: boolean }) {
  const read = useContext(WalletPanelContext);
  const shared = read?.customerId === customerId && read.enabled === enabled ? read : null;
  const [localPanel, setPanel] = useState<WalletPanel | null>(null);
  const panel = shared ? shared.panel : localPanel;
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyVisible = useRef(false);
  const [reversalCompleted, setReversalCompleted] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const usesSharedRead = shared !== null;
  const refresh = shared?.refresh ?? (() => setRevision(value => value + 1));
  useEffect(() => {
    if (!enabled || usesSharedRead) return;
    let current = true;
    setPanel(null); setError("");
    startTransition(async () => {
      try { const result = await walletPanelAction(customerId); if (current) { if (result.ok) setPanel(result.data); else setError(result.message); } }
      catch { if (current) setError("Wallet balance is unavailable. Try again."); }
    });
    return () => { current = false; };
  }, [customerId, revision, enabled, usesSharedRead]);
  function transactions(nextPage: number) {
    historyVisible.current = true;
    setHistoryOpen(true); setHistory(null); setError("");
    startTransition(async () => {
      try { const result = await walletHistoryAction(customerId, nextPage); if (result.ok) { setHistory(result.data); setPage(nextPage); } else setError(result.message); }
      catch { setError("Wallet transactions could not be loaded. Try again."); }
    });
  }
  function reversalSucceeded() {
    setReversalCompleted(true);
    refresh();
    if (historyVisible.current) transactions(page);
  }
  if (!enabled) return null;
  return <section className="wallet-ui" aria-label="Member wallet">
    {panel ? <WalletSummaryView panel={panel} entry={entry} compact={compact} onTopUp={() => setOpen(true)} onHistory={() => transactions(0)} /> : <p>{pending || shared?.pending ? "Loading wallet…" : shared?.error || error}<button type="button" className="secondary" disabled={pending || shared?.pending} onClick={refresh}>Refresh wallet</button></p>}
    {open && panel ? <WalletTopUpModal intentScope={panel.intentScope} customerId={customerId} customerName={customerName} balance={panel.totalBalance} onClose={() => { setOpen(false); refresh(); }} onSuccess={() => { /* Receipt uses the committed backend result. Refresh on Done. */ }} /> : null}
    {historyOpen ? <WalletDialog title="Wallet transactions" onClose={() => { historyVisible.current = false; setHistoryOpen(false); }}>
      {reversalCompleted ? <p role="status">Top-up reversed. Do not repeat this refund.</p> : null}
      {error ? <p role="alert" className="wallet-error">{error}</p> : null}
      {pending ? <p>Loading transactions…</p> : history ? <>
        {!history.rows.length ? <p>No wallet transactions yet.</p> : history.rows.map(row => <WalletHistoryRow key={row.id} row={row} />)}
        {history.canReverse ? <><label>Top-up reversal status<select value={reverseId ?? ""} onChange={e=>setReverseId(e.target.value||null)}><option value="">Select top-up</option>{history.reversalSources.map(row=><option key={row.id} value={row.id}>{row.date} · {row.offer} · RM {row.paidAmount}</option>)}</select></label>{reverseId ? <WalletRefundForm key={reverseId} sourceId={reverseId} kind="top-up" recoveryScope={`${history.refundScopePrefix}:top-up:${reverseId}`} onSuccess={reversalSucceeded} /> : null}</> : null}
        {!history.canReverse ? history.reversalSources.map(row=><WalletRefundForm key={row.id} sourceId={row.id} kind="top-up" recoveryScope={`${history.refundScopePrefix}:top-up:${row.id}`} recoveryOnly />) : null}
        <footer><button type="button" className="secondary" disabled={page === 0} onClick={() => {setReverseId(null);transactions(page - 1);}}>Previous</button><span>Page {page + 1}</span><button type="button" className="secondary" disabled={!history.hasMore} onClick={() => {setReverseId(null);transactions(page + 1);}}>Next</button></footer>
      </> : <button type="button" onClick={() => transactions(page)}>Try again</button>}
    </WalletDialog> : null}
  </section>;
}
