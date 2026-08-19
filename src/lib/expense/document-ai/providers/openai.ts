import OpenAI from "openai";
import type { ExpenseDocumentProvider, ExpenseDocumentProviderInput, ExpenseDocumentProviderResult } from "../provider";
import { normalizeExpenseDocumentExtraction } from "../normalization";
import { EXPENSE_DOCUMENT_JSON_SCHEMA } from "../schema";

type ResponsesClient = Pick<OpenAI, "responses">;

export class OpenAiExpenseDocumentProvider implements ExpenseDocumentProvider {
  readonly name = "openai";
  private readonly client: ResponsesClient;

  constructor(private readonly config: { apiKey: string; model: string; maxOutputTokens: number }, client?: ResponsesClient) {
    this.client = client ?? new OpenAI({ apiKey: config.apiKey, timeout: 45_000, maxRetries: 1 });
  }

  async extract(input: ExpenseDocumentProviderInput): Promise<ExpenseDocumentProviderResult> {
    const encoded = input.bytes.toString("base64");
    const document = input.mimeType === "application/pdf"
      ? { type: "input_file" as const, filename: input.fileName, file_data: `data:${input.mimeType};base64,${encoded}` }
      : { type: "input_image" as const, image_url: `data:${input.mimeType};base64,${encoded}`, detail: "high" as const };
    const response = await this.client.responses.create({
      model: this.config.model,
      max_output_tokens: this.config.maxOutputTokens,
      store: false,
      tools: [],
      instructions: [
        "Extract only clearly visible facts from this Malaysian business document for a human-reviewed expense draft.",
        "Never decide the final Tetamu workflow, category, duplicate status, payment state, confirmation, posting, or accounting treatment.",
        "Use Malaysia date convention DD/MM/YYYY for slash-form visible dates. Preserve every visible date exactly in its raw date field and separately provide YYYY-MM-DD.",
        "If both day and month are 12 or below, mark overall confidence LOW and add a warning that the date is ambiguous and needs human verification.",
        "Return currency as a three-letter ISO 4217 code. Normalize visible RM or Malaysian Ringgit to MYR, never RM.",
        "Return monetary values as decimal strings with exactly two digits and no currency symbols, commas, or exponent notation. Never return JSON numbers for money.",
        "Report PAID only when strong visible settlement evidence exists. For an expense receipt, Balance 0.00 together with an explicit tender or payment method such as DuitNow, cash, or card is strong evidence; Tetamu will validate it independently.",
        "CASHSALE is a document title, not evidence that cash was used. Lines such as Card RM, Maybank QR, DuitNow QR, merchant type QR, or card approval override that title and must be captured as payment evidence.",
        "Include short evidence signals for every visible balance, amount-paid or tender line, payment method, transaction reference, and explicit paid or unpaid wording.",
        "A supplier invoice, tax invoice with payment terms, due date, balance due, or outstanding amount should be suggested as SUPPLIER_INVOICE.",
        "A staff reimbursement or employee claim receipt should be suggested as CLAIM_RECEIPT. If uncertain use UNKNOWN and LOW confidence.",
        "Do not provide legal, accounting, or tax conclusions. Do not return raw OCR text. Evidence signals and warnings must be short and contain no sensitive secrets.",
      ].join(" "),
      input: [{ role: "user", content: [document, { type: "input_text", text: "Classify and extract the visible document facts into the strict response schema. Human review is mandatory." }] }],
      text: { format: { type: "json_schema", name: "tetamu_expense_document_v2", strict: true, schema: EXPENSE_DOCUMENT_JSON_SCHEMA } },
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.output_text);
    } catch {
      throw new Error("EXPENSE_DOCUMENT_AI_RESPONSE_INVALID");
    }
    return {
      extraction: normalizeExpenseDocumentExtraction(parsed),
      provider: this.name,
      model: this.config.model,
      providerRequestId: response._request_id ?? null,
    };
  }
}
