"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { walletTopUpAction, walletTopUpOptionsAction } from "@/app/(business)/crm/wallet/actions";
import { WalletTopUpIntent, type WalletIntentConfirmation } from "@/lib/wallet/top-up-intent";
import { WalletDialog } from "./wallet-dialog";
import { WalletConfirmation, WalletPendingConfirmation, walletMoney, walletAmountPreview } from "./wallet-views";
import "./wallet-top-up-modal.css";

function compactOfferAmount(amount: string) {
  return walletMoney(amount).replace("RM ", "RM").replace(/\.00$/, "");
}

type OptionsResult = Awaited<ReturnType<typeof walletTopUpOptionsAction>>;
type Options = Extract<OptionsResult, { ok: true }>["data"];
type Receipt = Extract<Awaited<ReturnType<typeof walletTopUpAction>>, { ok: true }>["data"];
export function WalletTopUpModal({ intentScope, customerId, customerName, balance, onClose, onSuccess }: { intentScope: string; customerId: string; customerName: string; balance: string; onClose: () => void; onSuccess: () => void }) {
  const intent = useRef<WalletTopUpIntent | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [offerId, setOfferId] = useState("");
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, startTransition] = useTransition();
  const [locked, setLocked] = useState(false);
  const [confirmation, setConfirmation] = useState<WalletIntentConfirmation | null>(null);
  const [storageFailed, setStorageFailed] = useState(false);
  const [modeChanged, setModeChanged] = useState(false);
  const offer = options?.offers.find(row => row.id === offerId);
  async function load(branchId?: string) {
    const result = await walletTopUpOptionsAction(customerId, branchId);
    if (!result.ok) { setOptions(null); setError(result.message); return; }
    setOptions(result.data);
    setOfferId(current => result.data.offers.some(row => row.id === current) ? current : "");
    setMethod(current => result.data.paymentMethods.some(row => row.code === current) ? current : result.data.paymentMethods[0]?.code ?? "");
  }
  useEffect(() => {
    try {
      const key = `tetamu:wallet-top-up:${intentScope}`;
      // sessionStorage survives redirects/Back/reload, isolated by business, actor and customer.
      intent.current = new WalletTopUpIntent({ read: () => sessionStorage.getItem(key), write: value => sessionStorage.setItem(key, value), remove: () => sessionStorage.removeItem(key) });
      setLocked(intent.current.locked);
      setConfirmation(intent.current.confirmation);
      if (intent.current.locked) setError("An earlier confirmation needs verification. Retry the same confirmation; do not collect payment again.");
    } catch { setStorageFailed(true); setError("This browser cannot safely retain the confirmation. Do not collect payment. Ask the business owner to review the browser's stored confirmation."); }
    startTransition(async () => { try { await load(); } catch { setError("Wallet options could not be loaded. Try again."); } });
  }, [customerId, intentScope]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);
  function confirm() {
    if (!intent.current || storageFailed || (!intent.current.locked && (!offer || !method || !options?.activity))) return;
    let request;
    try { request = intent.current.confirm(intent.current.existing ?? { customerId, offerId: offer!.id, expectedOfferVersion: offer!.version, paymentMethodCode: method, reference, ...options!.activity! }, !intent.current.locked && offer ? { offerName: offer.name, paymentMethodLabel: options!.paymentMethods.find(row => row.code === method)!.label, paidAmount: offer.paidAmount, bonusAmount: offer.bonusAmount, totalCredited: offer.totalCredited } : undefined); }
    catch { setStorageFailed(true); setError("The confirmation could not be safely retained. No request was sent. Check browser storage before continuing."); return; }
    if (!request) return;
    setLocked(true); setConfirmation(intent.current.confirmation); setError("");
    startTransition(async () => {
      try {
        const form = new FormData();
        Object.entries(request).forEach(([key, value]) => form.set(key, value == null ? "" : String(value)));
        const result = await walletTopUpAction(form);
        if (result.ok) { intent.current!.completed(); setLocked(false); setReceipt(result.data); onSuccess(); return; }
        setError(result.message);
        if (result.code === "CASHIER_SHIFT_MODE_CHANGED") {
          intent.current!.modeChanged(); setModeChanged(true);
          await load(request.branchId);
          return;
        }
        if (result.uncertain) { intent.current!.uncertain(); return; }
        // P1B checks version inside the idempotent transaction. A completed
        // original would replay instead; an old version cannot later become current.
        if (!intent.current!.rejected(result.code === "OFFER_CHANGED_RECONFIRM")) {
          setError(`${result.message} The earlier confirmation is still unresolved. Do not collect payment again; restore access and retry this same confirmation.`);
          return;
        }
        setLocked(false);
        setConfirmation(null);
        if (["OFFER_CHANGED_RECONFIRM", "WALLET_OFFER_UNAVAILABLE", "WALLET_PAYMENT_METHOD_DENIED"].includes(result.code)) await load();
      } catch {
        intent.current!.uncertain();
        setError("We could not confirm the result. Retry this same confirmation; do not collect payment again.");
      }
    });
  }
  return <WalletDialog title="Top up member wallet" onClose={onClose} locked={locked || pending}>
    {receipt ? <WalletConfirmation receipt={receipt} customerName={customerName} staffName={receipt.staffName} onDone={onClose} /> : <div className="wallet-top-up-modal">
      <dl className="wallet-amounts wallet-top-up-customer"><dt>Customer</dt><dd>{customerName}</dd><dt>Current wallet balance</dt><dd>{walletMoney(balance)}</dd></dl>
      {error ? <p role="alert" className="wallet-error">{error}</p> : null}
      {locked && confirmation ? <><WalletPendingConfirmation confirmation={confirmation} /><p className="wallet-note">Retry checks this same confirmation. Do not collect payment again.</p>
        {modeChanged ? <>
          {!confirmation.request.branchId && options && options.activity?.modeAtConfirmation !== "ON" ? <label>Collection branch<select aria-label="Review collection branch" value={options.activity?.branchId??""} disabled={pending} onChange={event=>{
            const branchId=event.target.value;setOptions(current=>current?{...current,activity:null}:null);
            if(branchId)startTransition(async()=>{try{await load(branchId);}catch{setError("Current branch settings could not be loaded.");}});
          }}><option value="">Select collection branch</option>{options.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
          {options?.activity ? <p>Collection branch: {options.branches.find(branch => branch.id === options.activity?.branchId)?.name}. Cashier shifts: {options.activity.modeAtConfirmation}</p> : null}
          <footer><button type="button" disabled={pending || storageFailed} onClick={() => startTransition(async () => { try { await load(confirmation.request.branchId); } catch { setError("Current cashier settings could not be loaded."); } })}>Reload current cashier settings</button>
          <button type="button" disabled={pending || storageFailed || !options?.activity || Boolean(confirmation.request.branchId && options.activity.branchId !== confirmation.request.branchId)} onClick={() => {
            try { intent.current!.reconfirmActivity(options!.activity!); setModeChanged(false); setConfirmation(intent.current!.confirmation); confirm(); }
            catch { setError("Could not safely reconfirm cashier settings. No new request was sent."); }
          }}>Confirm with current cashier settings</button></footer>
        </> : <footer><button type="button" disabled={pending || storageFailed} onClick={confirm}>{pending ? "Confirming…" : "Retry same confirmation"}</button></footer>}
      </> : options ? <div className="wallet-top-up-fields">
        <label>Collection branch<select aria-label="Collection branch" value={options.activity?.branchId ?? ""} disabled={locked || pending || options.activity?.modeAtConfirmation === "ON"} onChange={event => {
          const branchId = event.target.value;
          setOptions(current => current ? {...current,activity:null} : null);
          if (branchId) startTransition(async () => { try { await load(branchId); } catch { setError("Branch options could not be loaded. Try again."); } });
        }}><option value="">Select collection branch</option>{options.branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label>Top-up offer<select value={offerId} disabled={locked || pending} onChange={e => setOfferId(e.target.value)}><option value="">Select a top-up offer</option>{options.offers.map(row => <option key={row.id} value={row.id}>{row.name} · {compactOfferAmount(row.paidAmount)} + {compactOfferAmount(row.bonusAmount)} bonus</option>)}</select></label>
        {!options.offers.length ? <p className="wallet-note">No active top-up offers. Ask the business owner to create an offer.</p> : null}
        <div className="wallet-form-grid"><label>Payment method<select value={method} disabled={locked || pending} onChange={e => setMethod(e.target.value)}>{options.paymentMethods.map(row => <option key={row.code} value={row.code}>{row.label}</option>)}</select></label>
        <label>Reference (optional)<input value={reference} maxLength={500} disabled={locked || pending} onChange={e => setReference(e.target.value)} /></label></div>
        <dl className="wallet-amounts wallet-top-up-summary" aria-live="polite">
          <dt>Top-up amount</dt><dd>{walletMoney(offer?.paidAmount ?? "0.00")}</dd>
          <dt>Bonus credit</dt><dd>+{walletMoney(offer?.bonusAmount ?? "0.00")}</dd>
          <dt>Total wallet credit</dt><dd><strong>{walletMoney(offer?.totalCredited ?? "0.00")}</strong></dd>
          <dt className="wallet-top-up-result">Balance after top-up</dt><dd className="wallet-top-up-result"><strong>{walletMoney(walletAmountPreview(balance, offer?.totalCredited ?? "0.00") ?? balance)}</strong></dd>
        </dl>
        <p className="wallet-note">Confirm after receiving payment.<br />Tetamu POS records the top-up only; it does not charge the customer.</p>
        <footer><button type="button" className="secondary" disabled={locked || pending} onClick={onClose}>Cancel</button><button type="button" disabled={storageFailed || pending || (!locked && (!offer || !method || !options.activity))} onClick={confirm}>{pending ? "Confirming…" : locked ? "Retry same confirmation" : "Confirm top-up"}</button></footer>
      </div> : <footer>{locked ? <button type="button" disabled={pending || storageFailed} onClick={confirm}>Retry same confirmation</button> : <button type="button" disabled={pending} onClick={() => startTransition(async () => { try { await load(); } catch { setError("Wallet options could not be loaded. Try again."); } })}>{pending ? "Loading…" : "Try again"}</button>}</footer>}
    </div>}
  </WalletDialog>;
}
