"use client";
import { useState, useTransition } from "react";
import { saveWalletOfferAction, walletOffersAction } from "@/app/(business)/crm/wallet/actions";
import { WalletDialog } from "./wallet-dialog";
import { WalletTopUpOfferForm, walletMoney, type WalletOffer } from "./wallet-views";
import "./wallet.css";

export function WalletOffers({ businessId, initialOffers }: { businessId: string; initialOffers: WalletOffer[] }) {
  const [offers, setOffers] = useState(initialOffers);
  const [editing, setEditing] = useState<WalletOffer | "new" | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  function save(form: FormData) {
    startTransition(async () => {
      try {
        const result = await saveWalletOfferAction(form);
        const refreshed = await walletOffersAction();
        if (refreshed.ok) setOffers(refreshed.data);
        if (result.ok) { setEditing(null); setMessage("Top-up offer saved."); }
        else { setMessage(result.message); if (result.code === "OFFER_CHANGED_RECONFIRM") setEditing(null); }
      } catch { setMessage("The offer could not be confirmed. Refresh the page before trying again."); }
    });
  }
  function toggle(offer: WalletOffer) {
    const form = new FormData();
    Object.entries({ businessId, id: offer.id, version: offer.version, name: offer.name, paidAmount: offer.paidAmount, bonusAmount: offer.bonusAmount, active: !offer.active }).forEach(([key, value]) => form.set(key, String(value)));
    save(form);
  }
  return <div className="wallet-ui">
    <header className="wallet-offers-header"><div><h1>Top-up offers</h1><p>Set the amount customers pay and the credit their wallet receives.</p></div><button type="button" onClick={() => { setEditing("new"); setMessage(""); }}>Create offer</button></header>
    {message && !editing ? <p role="status" className="wallet-note">{message}</p> : null}
    <div className="wallet-table-wrap"><table className="wallet-table"><thead><tr><th>Name</th><th>Customer pays</th><th>Bonus</th><th>Wallet receives</th><th>Status</th><th>Actions</th></tr></thead><tbody>
      {offers.map(offer => <tr key={offer.id}><td>{offer.name}</td><td>{walletMoney(offer.paidAmount)}</td><td>{walletMoney(offer.bonusAmount)}</td><td>{walletMoney(offer.totalCredited)}</td><td>{offer.active ? "Active" : "Inactive"}</td><td><button type="button" className="secondary" disabled={pending} onClick={() => { setEditing(offer); setMessage(""); }}>Edit</button><button type="button" className="secondary" disabled={pending} onClick={() => toggle(offer)}>{offer.active ? "Deactivate" : "Activate"}</button></td></tr>)}
      {!offers.length ? <tr><td colSpan={6}>No top-up offers yet. Create an offer to get started.</td></tr> : null}
    </tbody></table></div>
    {editing ? <WalletDialog title={editing === "new" ? "New top-up offer" : "Edit top-up offer"} locked={pending} onClose={() => setEditing(null)}>{message ? <p role="alert" className="wallet-error">{message}</p> : null}<WalletTopUpOfferForm key={editing === "new" ? "new" : `${editing.id}:${editing.version}`} businessId={businessId} offer={editing === "new" ? undefined : editing} pending={pending} onSubmit={save} /></WalletDialog> : null}
  </div>;
}
