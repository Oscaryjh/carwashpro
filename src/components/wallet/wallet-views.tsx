"use client";

import { useState, type FormEvent } from "react";
import type { getWalletHistory, getWalletPanel, listWalletOffers } from "@/lib/wallet/ui-adapter";
import type { postWalletTopUp } from "@/lib/wallet/top-up";
import type { WalletIntentConfirmation } from "@/lib/wallet/top-up-intent";

export function WalletPendingConfirmation({ confirmation }: { confirmation: WalletIntentConfirmation }) {
  const { request, display } = confirmation;
  return <div><h3>Original confirmation</h3><dl className="wallet-amounts">
    <dt>Offer</dt><dd>{display?.offerName ?? request.offerId}</dd>
    <dt>Payment method</dt><dd>{display?.paymentMethodLabel ?? request.paymentMethodCode}</dd>
    <dt>Reference</dt><dd>{request.reference || "—"}</dd>
    {display ? <><dt>Customer pays</dt><dd>{walletMoney(display.paidAmount)}</dd><dt>Bonus credit</dt><dd>{walletMoney(display.bonusAmount)}</dd><dt>Wallet receives</dt><dd>{walletMoney(display.totalCredited)}</dd></> : null}
  </dl>{!display ? <p className="wallet-note">Original amounts were not saved by this older confirmation. Retry verifies the original request; do not collect payment again.</p> : null}</div>;
}

export type WalletPanel = Awaited<ReturnType<typeof getWalletPanel>>;
export type WalletOffer = Awaited<ReturnType<typeof listWalletOffers>>[number];
export type WalletReceipt = Pick<Awaited<ReturnType<typeof postWalletTopUp>>, "paidAmount" | "bonusAmount" | "totalCredited" | "totalBalance" | "postedAt" | "offerNameSnapshot" | "paymentMethodLabel" | "reference">;
export function walletMoney(value: string) {
  const [whole, cents = "00"] = value.split(".");
  return `RM ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${cents.padEnd(2, "0")}`;
}
function signedWalletMoney(value: string) {
  return value.startsWith("-") ? `-${walletMoney(value.slice(1))}` : `+${walletMoney(value)}`;
}
export function WalletHistoryRow({ row }: { row: Awaited<ReturnType<typeof getWalletHistory>>["rows"][number] }) {
  return <details className="wallet-history-row"><summary>
    <span>{new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(row.date))}<small>{row.type} · {row.source} · {row.staff}</small></span>
    <span>{signedWalletMoney(row.amount)}<small>Balance after: {walletMoney(row.balanceAfter)}</small></span>
  </summary><dl className="wallet-amounts">
    <dt>Paid credit</dt><dd>{signedWalletMoney(row.paidAmount)}</dd>
    <dt>Bonus credit</dt><dd>{signedWalletMoney(row.bonusAmount)}</dd>
    <dt>Source</dt><dd>{row.source}</dd>
    <dt>Staff</dt><dd>{row.staff}</dd>
  </dl></details>;
}
export function WalletSummaryView({ panel, entry, onTopUp, onHistory }: { panel: WalletPanel; entry: "customer" | "cashier"; onTopUp: () => void; onHistory: () => void }) {
  return <div className="wallet-summary">
    <div><h3>Member wallet</h3><span>Wallet balance</span><strong>{walletMoney(panel.totalBalance)}</strong></div>
    <div className="wallet-actions">
      {panel.canTopUp ? <button type="button" onClick={onTopUp}>{entry === "cashier" ? "Top up wallet" : "Top up"}</button> : null}
      {panel.ownerDetails && entry === "customer" ? <button type="button" className="secondary" onClick={onHistory}>View transactions</button> : null}
    </div>
    {panel.ownerDetails && entry === "customer" ? <details><summary>View details</summary><dl className="wallet-amounts"><dt>Paid credit</dt><dd>{walletMoney(panel.ownerDetails.paidBalance)}</dd><dt>Bonus credit</dt><dd>{walletMoney(panel.ownerDetails.bonusBalance)}</dd></dl></details> : null}
  </div>;
}
function receive(paid: string, bonus: string) {
  if (![paid, bonus].every(value => /^\d+(\.\d{1,2})?$/.test(value))) return null;
  const cents = (value: string) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")); };
  const total = cents(paid) + cents(bonus);
  return `${total / 100n}.${(total % 100n).toString().padStart(2, "0")}`;
}
export function WalletTopUpOfferForm({ businessId, offer, pending, onSubmit }: { businessId: string; offer?: WalletOffer; pending: boolean; onSubmit: (form: FormData) => void }) {
  const [paid, setPaid] = useState(offer?.paidAmount ?? "");
  const [bonus, setBonus] = useState(offer?.bonusAmount ?? "0");
  const total = receive(paid, bonus);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); onSubmit(new FormData(event.currentTarget)); }
  return <form className="wallet-offer-form" onSubmit={submit}>
    <input type="hidden" name="businessId" value={businessId} />
    {offer ? <><input type="hidden" name="id" value={offer.id} /><input type="hidden" name="version" value={offer.version} /></> : null}
    <label>Name<input name="name" required maxLength={160} defaultValue={offer?.name} /></label>
    <div className="wallet-form-grid">
      <label>Customer pays (RM)<input type="number" name="paidAmount" min="0.01" step="0.01" required value={paid} onChange={e => setPaid(e.target.value)} /></label>
      <label>Bonus (RM)<input type="number" name="bonusAmount" min="0" step="0.01" required value={bonus} onChange={e => setBonus(e.target.value)} /></label>
    </div>
    <dl className="wallet-amounts"><dt>Wallet receives</dt><dd>{total === null ? "—" : walletMoney(total)}</dd></dl>
    <label>Status<select name="active" defaultValue={String(offer?.active ?? true)}><option value="true">Active</option><option value="false">Inactive</option></select></label>
    <footer><button type="submit" disabled={pending}>{pending ? "Saving…" : offer ? "Save changes" : "Create offer"}</button></footer>
  </form>;
}
export function WalletConfirmation({ receipt, customerName, staffName, onDone }: { receipt: WalletReceipt; customerName: string; staffName: string; onDone: () => void }) {
  return <div><h3>Top-up successful</h3><p>Wallet top-up confirmation</p>
    <dl className="wallet-amounts">
      <dt>Customer</dt><dd>{customerName}</dd>
      <dt>Date/time</dt><dd>{new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" }).format(new Date(receipt.postedAt))} (MYT)</dd>
      <dt>Offer</dt><dd>{receipt.offerNameSnapshot}</dd>
      <dt>Customer paid</dt><dd>{walletMoney(receipt.paidAmount)}</dd><dt>Bonus credit</dt><dd>{walletMoney(receipt.bonusAmount)}</dd>
      <dt>Wallet received</dt><dd>{walletMoney(receipt.totalCredited)}</dd><dt>New wallet balance</dt><dd><strong>{walletMoney(receipt.totalBalance)}</strong></dd>
      <dt>Payment method</dt><dd>{receipt.paymentMethodLabel}</dd><dt>Reference</dt><dd>{receipt.reference || "—"}</dd><dt>Staff</dt><dd>{staffName}</dd>
    </dl><footer><button type="button" onClick={onDone}>Done</button></footer></div>;
}
