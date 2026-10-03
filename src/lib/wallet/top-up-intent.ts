import type { WalletTopUpInput } from "./top-up";

export type WalletIntentDisplay = { offerName: string; paymentMethodLabel: string; paidAmount: string; bonusAmount: string; totalCredited: string };
export type WalletIntentConfirmation = { request: WalletTopUpInput; display: WalletIntentDisplay | null };

/** One collection intent survives retries. An unknown outcome cannot become new money. */
export class WalletTopUpIntent {
  private request: WalletTopUpInput | null = null;
  private pending = false;
  private hadUnknownOutcome = false;
  private display: WalletIntentDisplay | null = null;
  private needsActivityConfirmation = false;
  constructor(private readonly storage?: { read: () => string | null; write: (value: string) => void; remove: () => void }) {
    const saved = storage?.read();
    if (saved) {
      const stored = JSON.parse(saved);
      const parsed = (stored?.request ?? stored) as WalletTopUpInput;
      if (!parsed || typeof parsed.operationKey !== "string" || typeof parsed.customerId !== "string" || typeof parsed.offerId !== "string" || typeof parsed.paymentMethodCode !== "string" || !Number.isInteger(parsed.expectedOfferVersion)) throw new Error("Invalid saved confirmation");
      this.request = parsed;
      if (stored?.request && stored.display) {
        const display = stored.display;
        if (![display.offerName, display.paymentMethodLabel].every(value => typeof value === "string") || ![display.paidAmount, display.bonusAmount, display.totalCredited].every(value => typeof value === "string" && /^\d+\.\d{2}$/.test(value))) throw new Error("Invalid saved confirmation display");
        this.display = display;
      }
      this.hadUnknownOutcome = true;
    }
  }
  get existing() { return this.request ? { ...this.request } : null; }
  get confirmation(): WalletIntentConfirmation | null { return this.request ? { request: { ...this.request }, display: this.display ? { ...this.display } : null } : null; }
  get locked() { return this.request !== null; }
  confirm(input: Omit<WalletTopUpInput, "operationKey">, display?: WalletIntentDisplay): WalletTopUpInput | null {
    if (this.pending) return null;
    if (!this.request) {
      const request = { ...input, operationKey: crypto.randomUUID() };
      // Display-only snapshot never enters the financial request. Keep it even if
      // the current offer changes or disappears while the result is unknown.
      this.storage?.write(JSON.stringify({ request, display: display ?? null }));
      this.request = request;
      this.display = display ? { ...display } : null;
    }
    this.pending = true;
    return { ...this.request };
  }
  uncertain() { this.pending = false; this.hadUnknownOutcome = true; }
  // Only the authoritative execute-time rejection permits changing these hints.
  // A timeout/auth failure never grants this; completed requests replay first.
  modeChanged() { this.pending = false; this.needsActivityConfirmation = true; }
  reconfirmActivity(activity: {modeAtConfirmation:"ON"|"OFF";branchId:string;shiftId:string|null}) {
    if (!this.request || !this.needsActivityConfirmation || this.pending) throw new Error("Explicit cashier activity reconfirmation is unavailable.");
    if (this.request.branchId && activity.branchId !== this.request.branchId) throw new Error("Keep the original collection branch.");
    const request = {...this.request,...activity};
    this.storage?.write(JSON.stringify({request,display:this.display}));
    this.request=request;
    this.needsActivityConfirmation=false;
  }
  rejected(authoritativeStaleVersion = false) {
    this.pending = false;
    if (this.hadUnknownOutcome && !authoritativeStaleVersion) return false;
    this.storage?.remove();
    this.request = null;
    this.display = null;
    this.hadUnknownOutcome = false;
    this.needsActivityConfirmation = false;
    return true;
  }
  completed() { this.storage?.remove(); this.hadUnknownOutcome = false; this.request = null; this.display = null; this.pending = false; this.needsActivityConfirmation = false; }
}
