-- Commit new enum values before the following migration uses them in constraints.
ALTER TYPE "PaymentMethod" ADD VALUE 'MEMBER_WALLET';
ALTER TYPE "FinancialOperationType" ADD VALUE 'WALLET_TOP_UP';
ALTER TYPE "FinancialOperationType" ADD VALUE 'WALLET_TOP_UP_REVERSAL';
