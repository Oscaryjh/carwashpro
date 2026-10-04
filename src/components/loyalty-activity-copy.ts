/** Display-only labels: never infer ledger meaning from persisted descriptions. */
export function formatLoyaltyActivityDetails(type: string | null | undefined): string {
  switch (type) {
    case "EARN": return "Points earned from purchase";
    case "REDEEM": return "Points redeemed at checkout";
    case "REDEMPTION_REFUND": return "Points restored from refund";
    case "REFUND_REVERSAL": return "Points reversed after refund";
    case "WELCOME_BONUS": return "Welcome points";
    case "MANUAL_ADJUSTMENT": return "Points adjusted";
    default: return "Points activity";
  }
}
