"use client";
import { useEffect, useState, useTransition } from "react";
import { walletPanelAction, walletHistoryAction } from "@/app/(business)/crm/wallet/actions";
import { WalletSummaryView, walletMoney, type WalletPanel } from "./wallet-views";
import { WalletTopUpModal } from "./wallet-top-up-modal";
import { WalletDialog } from "./wallet-dialog";
import { WalletRefundForm } from "./wallet-refund-form";
import "./wallet.css";

type History = Extract<Awaited<ReturnType<typeof walletHistoryAction>>, { ok: true }>["data"];
export function MemberWalletSummary({ customerId, customerName, entry = "customer" }: { customerId: string; customerName: string; entry?: "customer" | "cashier" }) {
  const [panel, setPanel] = useState<WalletPanel | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [page, setPage] = useState(0);
  const [pending, startTransition] = useTransition();
  const [revision, setRevision] = useState(0);
  const [reverseId, setReverseId] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    setPanel(null); setError("");
    startTransition(async () => {
      try { const result = await walletPanelAction(customerId); if (current) { if (result.ok) setPanel(result.data); else setError(result.message); } }
      catch { if (current) setError("Wallet balance is unavailable. Try again."); }
    });
    return () => { current = false; };
  }, [customerId, revision]);
  function transactions(nextPage: number) {
    setHistoryOpen(true); setHistory(null); setError("");
    startTransition(async () => {
      try { const result = await walletHistoryAction(customerId, nextPage); if (result.ok) { setHistory(result.data); setPage(nextPage); } else setError(result.message); }
      catch { setError("Wallet transactions could not be loaded. Try again."); }
    });
  }
  return <section className="wallet-ui" aria-label="Member wallet">
    {panel ? <WalletSummaryView panel={panel} entry={entry} onTopUp={() => setOpen(true)} onHistory={() => transactions(0)} /> : <p>{pending ? "Loading wallet…" : error}<button type="button" className="secondary" disabled={pending} onClick={() => setRevision(value => value + 1)}>Refresh wallet</button></p>}
    {open && panel ? <WalletTopUpModal intentScope={panel.intentScope} customerId={customerId} customerName={customerName} balance={panel.totalBalance} onClose={() => { setOpen(false); setRevision(value => value + 1); }} onSuccess={() => { /* Receipt uses the committed backend result. Refresh on Done. */ }} /> : null}
    {historyOpen ? <WalletDialog title="Wallet transactions" onClose={() => setHistoryOpen(false)}>
      {error ? <p role="alert" className="wallet-error">{error}</p> : null}
      {pending ? <p>Loading transactions…</p> : history ? <>
        {!history.rows.length ? <p>No wallet transactions yet.</p> : history.rows.map(row => <details key={row.id} className="wallet-history-row"><summary><span>{new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(row.date))}<small>{row.type} · {row.source} · {row.staff}</small></span><span>+{walletMoney(row.amount)}<small>Balance after: {row.balanceAfter === null ? "Unavailable" : walletMoney(row.balanceAfter)}</small></span></summary><dl className="wallet-amounts"><dt>Paid credit</dt><dd>+{walletMoney(row.paidAmount)}</dd><dt>Bonus credit</dt><dd>+{walletMoney(row.bonusAmount)}</dd><dt>Offer</dt><dd>{row.offer}</dd></dl></details>)}
        {history.canReverse ? <><label>Unused top-up to reverse<select value={reverseId ?? ""} onChange={e=>setReverseId(e.target.value||null)}><option value="">Select top-up</option>{history.rows.map(row=><option key={row.id} value={row.id}>{row.date} · {row.offer} · RM {row.paidAmount}</option>)}</select></label>{reverseId ? <WalletRefundForm key={reverseId} sourceId={reverseId} kind="top-up" recoveryScope={`${history.refundScopePrefix}:top-up:${reverseId}`} onSuccess={()=>setRevision(value=>value+1)} /> : null}</> : null}
        {!history.canReverse ? history.rows.map(row=><WalletRefundForm key={row.id} sourceId={row.id} kind="top-up" recoveryScope={`${history.refundScopePrefix}:top-up:${row.id}`} recoveryOnly />) : null}
        <footer><button type="button" className="secondary" disabled={page === 0} onClick={() => {setReverseId(null);transactions(page - 1);}}>Previous</button><span>Page {page + 1}</span><button type="button" className="secondary" disabled={!history.hasMore} onClick={() => {setReverseId(null);transactions(page + 1);}}>Next</button></footer>
      </> : <button type="button" onClick={() => transactions(page)}>Try again</button>}
    </WalletDialog> : null}
  </section>;
}
