export const DAILY_CLOSING_PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "DUITNOW",
  "EWALLET",
  "BANK_TRANSFER",
  "FOREIGN_CURRENCY",
  "CRYPTO",
] as const;

export type DailyClosingPaymentMethod = (typeof DAILY_CLOSING_PAYMENT_METHODS)[number];
export type DailyClosingIndustry = "AUTO_DETAILING" | "SALON_BEAUTY";

export function isDailyClosingIndustry(
  value: string | null | undefined,
): value is DailyClosingIndustry {
  return value === "AUTO_DETAILING" || value === "SALON_BEAUTY";
}

export type DailyClosingInvoice = {
  balanceCents: number;
  customerId: string | null;
  discountCents: number;
  id: string;
  items: {
    completedOperation: boolean;
    name: string;
    quantity: number;
    salesCents: number;
    serviceId: string | null;
  }[];
  loyaltyDiscountCents: number;
  packageVoucherCents: number;
  status: "UNPAID" | "PARTIAL" | "PAID" | "REFUNDED";
  tipCents: number;
  totalCents: number;
};

export type DailyClosingSourceData = {
  appointments: {
    customerId: string;
    status: "COMPLETED" | "CANCELLED";
  }[];
  customers: {
    createdAt: Date;
    id: string;
  }[];
  drawerExpensePayouts: {
    amountCents: number;
  }[];
  invoices: DailyClosingInvoice[];
  packagePurchases: {
    amountCents: number;
    id: string;
  }[];
  payments: {
    amountCents: number;
    method: DailyClosingPaymentMethod | "PACKAGE";
    packageUses: number;
  }[];
  refunds: {
    amountCents: number;
    method: DailyClosingPaymentMethod | "PACKAGE";
    packageUsesRestored: number;
  }[];
  shifts: {
    cashDifferenceCents: number | null;
    isOpen: boolean;
  }[];
  workOrders: {
    customerId: string;
    status: "COMPLETED" | "CANCELLED";
    vehicleId: string;
  }[];
};

export type DailyClosingAlert = {
  level: "info" | "warning";
  message: string;
};

export type DailyClosingReport = {
  alerts: DailyClosingAlert[];
  financial: {
    collectedCents: number;
    discountsCents: number;
    grossSalesCents: number;
    netSalesCents: number;
    outstandingCents: number;
    refundsCents: number;
  };
  cashDrawer: {
    expensePayoutCents: number;
  };
  invoiceCounts: {
    paid: number;
    partial: number;
    refunded: number;
    total: number;
    unpaid: number;
  };
  operations: {
    averageSpendCents: number;
    cancelled: number;
    completed: number;
    customersServed: number;
    newCustomers: number;
    returningCustomers: number;
    vehiclesServed: number;
  };
  packages: {
    amountCents: number;
    redemptions: number;
    sold: number;
  };
  paymentMethods: {
    grossCents: number;
    method: DailyClosingPaymentMethod;
    netCents: number;
    refundCents: number;
  }[];
  topServices: {
    name: string;
    quantity: number;
    salesCents: number;
    serviceId: string;
  }[];
};
