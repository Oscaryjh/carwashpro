export type ExpensePaymentMethodValue = "BANK_TRANSFER" | "CARD" | "CASH" | "EWALLET" | "OTHER";
export type ExpensePaymentSourceValue = "BANK_ACCOUNT" | "COMPANY_CARD" | "OTHER" | "OWNER_ADVANCE" | "PETTY_CASH" | "POS_DRAWER" | "STAFF_ADVANCE";

export type ExpensePaymentAccount = Readonly<{
  label: string;
  paymentMethod: ExpensePaymentMethodValue;
  paymentSource: ExpensePaymentSourceValue;
  value: string;
}>;

export const EXPENSE_PAYMENT_ACCOUNTS: readonly ExpensePaymentAccount[] = [
  account("POS_DRAWER_CASH", "POS drawer cash", "CASH", "POS_DRAWER"),
  account("PETTY_CASH", "Petty cash", "CASH", "PETTY_CASH"),
  account("BUSINESS_BANK", "Business bank transfer", "BANK_TRANSFER", "BANK_ACCOUNT"),
  account("BUSINESS_DUITNOW", "Business DuitNow / e-wallet", "EWALLET", "BANK_ACCOUNT"),
  account("COMPANY_CARD", "Company card", "CARD", "COMPANY_CARD"),
  account("OWNER_ADVANCE", "Owner paid personally", "OTHER", "OWNER_ADVANCE"),
  account("STAFF_ADVANCE", "Staff paid personally", "OTHER", "STAFF_ADVANCE"),
  account("OTHER", "Other payment source", "OTHER", "OTHER"),
];

export function resolveExpensePaymentAccount(value: string) {
  return EXPENSE_PAYMENT_ACCOUNTS.find((option) => option.value === value) ?? null;
}

export function expensePaymentAccountValue(paymentMethod: string, paymentSource: string) {
  return EXPENSE_PAYMENT_ACCOUNTS.find((option) => option.paymentMethod === paymentMethod && option.paymentSource === paymentSource)?.value ?? "";
}

function account(value: string, label: string, paymentMethod: ExpensePaymentMethodValue, paymentSource: ExpensePaymentSourceValue): ExpensePaymentAccount {
  return { label, paymentMethod, paymentSource, value };
}
