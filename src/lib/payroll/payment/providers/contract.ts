/**
 * Provider-neutral bank-file contract.
 *
 * This module intentionally contains no bank format assumptions. A provider
 * adapter may only be added after the bank's official field-level format and
 * golden fixtures have been obtained and reviewed.
 */

export type PaymentValidationField =
  | "ACCOUNT_NUMBER"
  | "AMOUNT"
  | "BANK_IDENTIFIER"
  | "BATCH"
  | "BENEFICIARY_NAME"
  | "CONFIGURATION"
  | "CURRENCY"
  | "FILENAME"
  | "PAYMENT_DATE"
  | "REFERENCE";

export type PaymentValidationIssue = Readonly<{
  code: string;
  field?: PaymentValidationField;
  instructionId?: string;
}>;

export type PaymentValidationResult = Readonly<{
  issues: readonly PaymentValidationIssue[];
  valid: boolean;
}>;

export type PaymentProviderConfiguration = Readonly<{
  configurationRevision: string;
  providerKey: string;
  /** Server-only values. They must never enter DTOs, HTML, audit or logs. */
  values: Readonly<Record<string, string>>;
}>;

export type PaymentArtifactBatchSnapshot = Readonly<{
  batchId: string;
  batchNumber: string;
  batchRevision: number;
  businessId: string;
  currency: string;
  instructionCount: number;
  payrollRunId: string;
  /** Null until a provider's official payment-date rule is implemented. */
  requestedPaymentDate: string | null;
  totalAmount: string;
}>;

export type PaymentArtifactInstructionSnapshot = Readonly<{
  amount: string;
  bankCode: string | null;
  bankName: string | null;
  /** Decrypted from the frozen instruction snapshot only at build time. */
  beneficiaryAccountNumber: string | null;
  beneficiaryName: string;
  currency: string;
  employeeCode: string;
  instructionId: string;
  /** Stable caller-assigned order within the frozen batch snapshot. */
  instructionSequence: number;
  /** Must come from a bank-confirmed provider mapping, never display names. */
  officialBankIdentifier: string | null;
  reference: string;
}>;

export type PaymentControlTotals = Readonly<{
  amount: string;
  recordCount: number;
  safeProviderValues?: Readonly<Record<string, string | number>>;
}>;

export type PaymentArtifactBuildContext = Readonly<{
  artifactRevision: number;
  batch: PaymentArtifactBatchSnapshot;
  configuration: PaymentProviderConfiguration;
  formatVersion: string;
  providerKey: string;
}>;

export type PaymentBuiltArtifact = Readonly<{
  bytes: Uint8Array;
  contentType: string;
  controlTotals: PaymentControlTotals;
  fileExtension: string;
  filename: string;
  recordCount: number;
}>;

export interface PaymentBankAdapter {
  readonly contentType: string;
  readonly fileExtension: string;
  readonly formatVersion: string;
  readonly providerKey: string;

  validateConfiguration(
    configuration: PaymentProviderConfiguration,
  ): PaymentValidationResult;

  validateBatch(batch: PaymentArtifactBatchSnapshot): PaymentValidationResult;

  validateInstruction(
    instruction: PaymentArtifactInstructionSnapshot,
  ): PaymentValidationResult;

  verifyLimits(
    batch: PaymentArtifactBatchSnapshot,
    instructions: readonly PaymentArtifactInstructionSnapshot[],
  ): PaymentValidationResult;

  calculateControlTotals(
    instructions: readonly PaymentArtifactInstructionSnapshot[],
  ): PaymentControlTotals;

  buildFilename(context: PaymentArtifactBuildContext): string;

  /** Must be deterministic for the same frozen inputs and configuration. */
  buildArtifact(
    context: PaymentArtifactBuildContext,
    /** Frozen snapshots in ascending instructionSequence order. */
    instructions: readonly PaymentArtifactInstructionSnapshot[],
  ): PaymentBuiltArtifact;
}
