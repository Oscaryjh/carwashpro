-- PCB distinguishes ordinary monthly remuneration from additional remuneration.
-- Keep the review decision immutable while allowing HR to record that distinction.
ALTER TYPE "StatutoryComponentReviewDecisionValue"
  ADD VALUE IF NOT EXISTS 'ADDITIONAL_REMUNERATION';
