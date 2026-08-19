import type { ExpenseDocumentProvider, ExpenseDocumentProviderInput, ExpenseDocumentProviderResult } from "../provider";
import type { ExpenseDocumentExtraction } from "../schema";

export class MockExpenseDocumentProvider implements ExpenseDocumentProvider {
  readonly name = "mock";

  async extract(input: ExpenseDocumentProviderInput): Promise<ExpenseDocumentProviderResult> {
    const name = input.fileName.toLowerCase();
    const supplier = /supplier|invoice|bill/.test(name);
    const claim = /claim|reimburse/.test(name);
    const extraction: ExpenseDocumentExtraction = {
      documentType: supplier ? "SUPPLIER_INVOICE" : claim ? "CLAIM_RECEIPT" : "EXPENSE_RECEIPT",
      confidence: "MEDIUM",
      merchantName: null,
      invoiceNumber: null,
      rawDocumentDate: null,
      documentDate: null,
      rawDueDate: null,
      dueDate: null,
      currency: "MYR",
      subtotal: null,
      taxAmount: null,
      totalAmount: null,
      description: null,
      categoryHint: null,
      paymentStatus: "UNKNOWN",
      paymentMethod: "UNKNOWN",
      rawPaymentDate: null,
      paymentDate: null,
      paymentReference: null,
      fieldConfidence: {
        merchantName: null,
        invoiceNumber: null,
        documentDate: null,
        dueDate: null,
        currency: 1,
        subtotal: null,
        taxAmount: null,
        totalAmount: null,
        paymentStatus: null,
        paymentDate: null,
      },
      evidenceSignals: ["Local testing mock; human review required"],
      warnings: ["Mock extraction does not read document contents. Verify every field manually."],
    };
    return { extraction, provider: this.name, model: "tetamu-expense-document-mock-2", providerRequestId: null };
  }
}
