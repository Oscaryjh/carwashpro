export type WhatsAppDeliveryEventStatus =
  | "SENT_TO_SERVER"
  | "DELIVERED"
  | "READ"
  | "FAILED";

export type WhatsAppStatusTransitionPlan = Readonly<{
  nextStatus: string;
  outcome: "ADVANCED" | "DUPLICATE" | "FACT_COMPLETED" | "IGNORED_DOWNGRADE";
  setDeliveredAt: boolean;
  setFailedAt: boolean;
  setReadAt: boolean;
  stateChanged: boolean;
  shouldMutate: boolean;
}>;

export function getWhatsAppStatusRank(status: string) {
  switch (status) {
    case "DRAFT":
    case "QUEUED":
      return 0;
    case "OPENED":
    case "SENDING":
      return 1;
    case "SENT":
    case "SENT_MANUALLY":
    case "SENT_TO_SERVER":
      return 2;
    case "DELIVERED":
      return 3;
    case "READ":
      return 4;
    case "FAILED":
      return -1;
    case "CANCELLED":
      return 5;
    default:
      return -2;
  }
}

export function planWhatsAppStatusTransition(input: {
  currentStatus: string;
  deliveredAt?: Date | null;
  failedAt?: Date | null;
  nextStatus: WhatsAppDeliveryEventStatus;
  readAt?: Date | null;
}): WhatsAppStatusTransitionPlan {
  const currentRank = getWhatsAppStatusRank(input.currentStatus);
  const nextRank = getWhatsAppStatusRank(input.nextStatus);

  if (input.nextStatus === "FAILED") {
    const ignored =
      input.currentStatus === "FAILED" ||
      input.currentStatus === "CANCELLED" ||
      currentRank >= getWhatsAppStatusRank("DELIVERED");

    if (ignored) {
      return {
        nextStatus: input.currentStatus,
        outcome:
          input.currentStatus === "FAILED" ? "DUPLICATE" : "IGNORED_DOWNGRADE",
        setDeliveredAt: false,
        setFailedAt: false,
        setReadAt: false,
        stateChanged: false,
        shouldMutate: false,
      };
    }

    return {
      nextStatus: "FAILED",
      outcome: "ADVANCED",
      setDeliveredAt: false,
      setFailedAt: !input.failedAt,
      setReadAt: false,
      stateChanged: input.currentStatus !== "FAILED",
      shouldMutate: true,
    };
  }

  const stateChanged = nextRank > currentRank;
  const setDeliveredAt =
    (input.nextStatus === "DELIVERED" || input.nextStatus === "READ") &&
    !input.deliveredAt;
  const setReadAt = input.nextStatus === "READ" && !input.readAt;
  const shouldMutate = stateChanged || setDeliveredAt || setReadAt;

  return {
    nextStatus: stateChanged ? input.nextStatus : input.currentStatus,
    outcome: stateChanged
      ? "ADVANCED"
      : shouldMutate
        ? "FACT_COMPLETED"
        : nextRank === currentRank
          ? "DUPLICATE"
          : "IGNORED_DOWNGRADE",
    setDeliveredAt,
    setFailedAt: false,
    setReadAt,
    stateChanged,
    shouldMutate,
  };
}
