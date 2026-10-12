// Presentation only: callers supply the existing effective capability and allowance.
export function getAskTetamuViewState(input: { canUse: boolean; configured: boolean; status: string; remainingRequests?: number | null; pilotAccess?: "owner" | "restricted" }) {
  if (input.pilotAccess === "restricted") return { canAsk: false, label: "Owner Pilot", reason: "Ask Tetamu Pilot is currently available to Business Owners only." };
  if (!input.configured) return { canAsk: false, label: "Usage not configured", reason: "AI usage allowance hasn't been configured for this business. Contact your Tetamu account administrator to configure AI usage." };
  if (!input.canUse) return { canAsk: false, label: "Read-only", reason: "You can view previous conversations, but new questions are disabled for your access." };
  if (input.status !== "ACTIVE") return { canAsk: false, label: "Unavailable", reason: "Ask Tetamu is temporarily unavailable for this business." };
  if (input.remainingRequests === 0) return { canAsk: false, label: "Monthly limit reached", reason: "You've reached this month's Ask Tetamu limit. You can still view previous conversations." };
  return { canAsk: true, label: "Read-only business data", reason: undefined };
}
