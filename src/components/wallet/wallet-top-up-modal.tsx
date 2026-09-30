"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { walletTopUpAction, walletTopUpOptionsAction } from "@/app/(business)/crm/wallet/actions";
import { WalletTopUpIntent, type WalletIntentConfirmation } from "@/lib/wallet/top-up-intent";
import { WalletDialog } from "./wallet-dialog";
import { WalletConfirmation, WalletPendingConfirmation, walletMoney } from "./wallet-views";

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
  const offer = options?.offers.find(row => row.id === offerId);
  async function load() {
    const result = await walletTopUpOptionsAction(customerId);
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
    if (!intent.current || storageFailed || (!intent.current.locked && (!offer || !method))) return;
    let request;
    try { request = intent.current.confirm(intent.current.existing ?? { customerId, offerId: offer!.id, expectedOfferVersion: offer!.version, paymentMethodCode: method, reference }, !intent.current.locked && offer ? { offerName: offer.name, paymentMethodLabel: options!.paymentMethods.find(row => row.code === method)!.label, paidAmount: offer.paidAmount, bonusAmount: offer.bonusAmount, totalCredited: offer.totalCredited } : undefined); }
    catch { setStorageFailed(true); setError("The confirmation could not be safely retained. No request was sent. Check browser storage before continuing."); return; }
    if (!request) return;
    setLocked(true); setConfirmation(intent.current.confirmation); setError("");
    startTransition(async () => {
      try {
        const form = new FormData();
        Object.entries(request).forEach(([key, value]) => form.set(key, String(value)));
        const result = await walletTopUpAction(form);
        if (result.ok) { intent.current!.completed(); setLocked(false); setReceipt(result.data); onSuccess(); return; }
        setError(result.message);
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
    {receipt ? <WalletConfirmation receipt={receipt} customerName={customerName} staffName={receipt.staffName} onDone={onClose} /> : <>
      <dl className="wallet-amounts"><dt>Customer</dt><dd>{customerName}</dd><dt>Wallet balance</dt><dd>{walletMoney(balance)}</dd></dl>
      {error ? <p role="alert" className="wallet-error">{error}</p> : null}
      {locked && confirmation ? <><WalletPendingConfirmation confirmation={confirmation} /><p className="wallet-note">Retry checks this same confirmation. Do not collect payment again.</p><footer><button type="button" disabled={pending || storageFailed} onClick={confirm}>{pending ? "Confirming…" : "Retry same confirmation"}</button></footer></> : options ? <div className="wallet-top-up-fields">
        <label>Select offer<select value={offerId} disabled={locked || pending} onChange={e => setOfferId(e.target.value)}><option value="">Select a top-up offer</option>{options.offers.map(row => <option key={row.id} value={row.id}>{row.name} — Pay {walletMoney(row.paidAmount)}, bonus {walletMoney(row.bonusAmount)}, receive {walletMoney(row.totalCredited)}</option>)}</select></label>
        {!options.offers.length ? <p className="wallet-note">No active top-up offers. Ask the business owner to create an offer.</p> : null}
        <div className="wallet-form-grid"><label>Payment method<select value={method} disabled={locked || pending} onChange={e => setMethod(e.target.value)}>{options.paymentMethods.map(row => <option key={row.code} value={row.code}>{row.label}</option>)}</select></label>
        <label>Reference (optional)<input value={reference} maxLength={500} disabled={locked || pending} onChange={e => setReference(e.target.value)} /></label></div>
        {offer ? <dl className="wallet-amounts"><dt>Customer pays</dt><dd>{walletMoney(offer.paidAmount)}</dd><dt>Bonus credit</dt><dd>{walletMoney(offer.bonusAmount)}</dd><dt>Wallet receives</dt><dd><strong>{walletMoney(offer.totalCredited)}</strong></dd></dl> : null}
        <p className="wallet-note">Confirm only after collecting the payment. This records a wallet top-up; it does not charge a bank or payment provider.</p>
        <footer><button type="button" disabled={storageFailed || pending || (!locked && (!offer || !method))} onClick={confirm}>{pending ? "Confirming…" : locked ? "Retry same confirmation" : "Confirm top-up"}</button></footer>
      </div> : <footer>{locked ? <button type="button" disabled={pending || storageFailed} onClick={confirm}>Retry same confirmation</button> : <button type="button" disabled={pending} onClick={() => startTransition(async () => { try { await load(); } catch { setError("Wallet options could not be loaded. Try again."); } })}>{pending ? "Loading…" : "Try again"}</button>}</footer>}
    </>}
  </WalletDialog>;
}
