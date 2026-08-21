import type { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  pcbTp1DeclarationEntriesSchema,
  pcbTp3DeclarationEntriesSchema,
  sumPcbTp1Deductions,
  sumPcbTp1Zakat,
  sumPcbTp3Deductions,
} from "./pcb-declarations";

const nonNegativeCents = z.number().int().min(0).max(999_999_999_999);
const childCount = z.number().int().min(0).max(99);

const pcbProfileBaseSchema = z.object({
  taxYear: z.literal(2026),
  taxRegime: z.enum([
    "RESIDENT_STANDARD",
    "NON_RESIDENT",
    "RETURNING_EXPERT_PROGRAM",
    "KNOWLEDGE_WORKER",
    "C_SUITE_NON_CITIZEN",
  ]),
  employeeCategory: z.enum(["CATEGORY_1", "CATEGORY_2", "CATEGORY_3"]),
  individualDisabled: z.boolean(),
  spouseDisabled: z.boolean(),
  children: z.object({
    under18Full: childCount,
    under18Half: childCount,
    studying18PlusFull: childCount,
    studying18PlusHalf: childCount,
    diplomaOrDegreeFull: childCount,
    diplomaOrDegreeHalf: childCount,
    disabledFull: childCount,
    disabledHalf: childCount,
    disabledStudyingFull: childCount,
    disabledStudyingHalf: childCount,
  }),
  priorEmployerGrossRemunerationCents: nonNegativeCents,
  priorEmployerEpfCents: nonNegativeCents,
  priorEmployerPcbCents: nonNegativeCents,
  priorEmployerAllowableDeductionsCents: nonNegativeCents,
  priorEmployerZakatCents: nonNegativeCents,
  currentAllowableDeductionsCents: nonNegativeCents,
  currentZakatCents: nonNegativeCents,
  currentReligiousTravelLevyCents: nonNegativeCents,
  confirmedAt: z.string().datetime({ offset: true }),
});

const declarationTimestamp = z.string().datetime({ offset: true });
const declarationReference = z.string().trim().min(3).max(240).nullable();

const pcbProfileV1Schema = pcbProfileBaseSchema.extend({
  version: z.literal(1),
});

const pcbProfileV2Schema = pcbProfileBaseSchema.extend({
  version: z.literal(2),
  tp1Declaration: z.object({
    formVersion: z.literal("HASIL_TP1_1_2026_BM"),
    status: z.enum(["NOT_APPLICABLE", "CONFIRMED"]),
    allowableDeductionsCents: nonNegativeCents,
    zakatCents: nonNegativeCents,
    sourceReference: declarationReference,
    declaredAt: declarationTimestamp,
    reviewedAt: declarationTimestamp,
  }),
  tp3Declaration: z.object({
    formVersion: z.literal("HASIL_TP3_1_2026_BM"),
    status: z.enum(["NOT_APPLICABLE", "CONFIRMED"]),
    grossRemunerationCents: nonNegativeCents,
    epfCents: nonNegativeCents,
    pcbCents: nonNegativeCents,
    allowableDeductionsCents: nonNegativeCents,
    zakatCents: nonNegativeCents,
    sourceReference: declarationReference,
    declaredAt: declarationTimestamp,
    reviewedAt: declarationTimestamp,
  }),
  religiousTravelLevyDeclaration: z.object({
    status: z.enum(["NOT_APPLICABLE", "CONFIRMED"]),
    amountCents: nonNegativeCents,
    sourceReference: declarationReference,
    declaredAt: declarationTimestamp,
    reviewedAt: declarationTimestamp,
  }),
});

const pcbProfileV3Schema = pcbProfileBaseSchema.extend({
  version: z.literal(3),
  profileRevision: z.number().int().min(1),
  tp1Declaration: z.object({
    formVersion: z.literal("HASIL_TP1_1_2026_BM"),
    status: z.enum(["NOT_APPLICABLE", "CONFIRMED"]),
    entries: pcbTp1DeclarationEntriesSchema,
    sourceReference: declarationReference,
    declaredAt: declarationTimestamp,
    reviewedAt: declarationTimestamp,
  }),
  tp3Declaration: z.object({
    formVersion: z.literal("HASIL_TP3_1_2026_BM"),
    status: z.enum(["NOT_APPLICABLE", "CONFIRMED"]),
    grossRemunerationCents: nonNegativeCents,
    epfCents: nonNegativeCents,
    pcbCents: nonNegativeCents,
    zakatCents: nonNegativeCents.default(0),
    entries: pcbTp3DeclarationEntriesSchema,
    sourceReference: declarationReference,
    declaredAt: declarationTimestamp,
    reviewedAt: declarationTimestamp,
  }),
  religiousTravelLevyDeclaration: z.object({
    status: z.enum(["NOT_APPLICABLE", "CONFIRMED"]),
    amountCents: nonNegativeCents,
    sourceReference: declarationReference,
    declaredAt: declarationTimestamp,
    reviewedAt: declarationTimestamp,
  }),
});

export const pcbProfileDataSchema = z.discriminatedUnion("version", [
  pcbProfileV1Schema,
  pcbProfileV2Schema,
  pcbProfileV3Schema,
]).superRefine((profile, context) => {
  if (profile.version === 1) return;
  const requireReference = (
    status: "NOT_APPLICABLE" | "CONFIRMED",
    reference: string | null,
    path: string,
  ) => {
    if (status === "CONFIRMED" && !reference) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Add the declaration or evidence reference.",
        path: [path, "sourceReference"],
      });
    }
  };
  requireReference(
    profile.tp1Declaration.status,
    profile.tp1Declaration.sourceReference,
    "tp1Declaration",
  );
  requireReference(
    profile.tp3Declaration.status,
    profile.tp3Declaration.sourceReference,
    "tp3Declaration",
  );
  requireReference(
    profile.religiousTravelLevyDeclaration.status,
    profile.religiousTravelLevyDeclaration.sourceReference,
    "religiousTravelLevyDeclaration",
  );

  const assertNotApplicableIsZero = (
    status: "NOT_APPLICABLE" | "CONFIRMED",
    amounts: number[],
    path: string,
  ) => {
    if (status === "NOT_APPLICABLE" && amounts.some((amount) => amount !== 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Amounts must be zero when the declaration is not applicable.",
        path: [path],
      });
    }
  };
  assertNotApplicableIsZero(
    profile.tp1Declaration.status,
    [
      profile.version === 2
        ? profile.tp1Declaration.allowableDeductionsCents
        : sumPcbTp1Deductions(profile.tp1Declaration.entries),
      profile.version === 2
        ? profile.tp1Declaration.zakatCents
        : sumPcbTp1Zakat(profile.tp1Declaration.entries),
    ],
    "tp1Declaration",
  );
  assertNotApplicableIsZero(
    profile.tp3Declaration.status,
    [
      profile.tp3Declaration.grossRemunerationCents,
      profile.tp3Declaration.epfCents,
      profile.tp3Declaration.pcbCents,
      profile.version === 2
        ? profile.tp3Declaration.allowableDeductionsCents
        : sumPcbTp3Deductions(profile.tp3Declaration.entries),
      profile.version === 2
        ? profile.tp3Declaration.zakatCents
        : profile.tp3Declaration.zakatCents,
    ],
    "tp3Declaration",
  );
  assertNotApplicableIsZero(
    profile.religiousTravelLevyDeclaration.status,
    [profile.religiousTravelLevyDeclaration.amountCents],
    "religiousTravelLevyDeclaration",
  );

  const matchingAmounts: Array<[number, number, string]> = [
    [
      profile.currentAllowableDeductionsCents,
      profile.version === 2
        ? profile.tp1Declaration.allowableDeductionsCents
        : sumPcbTp1Deductions(profile.tp1Declaration.entries),
      "currentAllowableDeductionsCents",
    ],
    [
      profile.currentZakatCents,
      profile.version === 2
        ? profile.tp1Declaration.zakatCents
        : sumPcbTp1Zakat(profile.tp1Declaration.entries),
      "currentZakatCents",
    ],
    [
      profile.priorEmployerGrossRemunerationCents,
      profile.tp3Declaration.grossRemunerationCents,
      "priorEmployerGrossRemunerationCents",
    ],
    [profile.priorEmployerEpfCents, profile.tp3Declaration.epfCents, "priorEmployerEpfCents"],
    [profile.priorEmployerPcbCents, profile.tp3Declaration.pcbCents, "priorEmployerPcbCents"],
    [
      profile.priorEmployerAllowableDeductionsCents,
      profile.version === 2
        ? profile.tp3Declaration.allowableDeductionsCents
        : sumPcbTp3Deductions(profile.tp3Declaration.entries),
      "priorEmployerAllowableDeductionsCents",
    ],
    [
      profile.priorEmployerZakatCents,
      profile.version === 2
        ? profile.tp3Declaration.zakatCents
        : profile.tp3Declaration.zakatCents,
      "priorEmployerZakatCents",
    ],
    [
      profile.currentReligiousTravelLevyCents,
      profile.religiousTravelLevyDeclaration.amountCents,
      "currentReligiousTravelLevyCents",
    ],
  ];
  for (const [aggregate, declaration, path] of matchingAmounts) {
    if (aggregate !== declaration) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "The calculation amount must match its declaration record.",
        path: [path],
      });
    }
  }
});

export type EmployeePcbProfile = z.infer<typeof pcbProfileDataSchema>;

export type GovernedEmployeePcbProfile = Extract<EmployeePcbProfile, { version: 3 }>;

export function isGovernedEmployeePcbProfile(
  profile: EmployeePcbProfile | null | undefined,
): profile is GovernedEmployeePcbProfile {
  return profile?.version === 3;
}

export type PcbProfileReadiness = {
  status: "READY" | "REVIEW_REQUIRED" | "MISSING";
  reasons: string[];
};

export function getPcbProfileReadiness(
  profile: EmployeePcbProfile | null | undefined,
): PcbProfileReadiness {
  if (!profile) {
    return {
      status: "MISSING",
      reasons: ["Confirm the employee tax facts before automatic PCB can run."],
    };
  }
  if (profile.version !== 3) {
    return {
      status: "REVIEW_REQUIRED",
      reasons: ["Reconfirm TP1 and TP3 using the structured 2026 declaration fields."],
    };
  }
  const reasons: string[] = [];
  if (profile.tp1Declaration.status === "CONFIRMED" && !profile.tp1Declaration.sourceReference) {
    reasons.push("Add the accepted TP1 declaration reference.");
  }
  if (profile.tp3Declaration.status === "CONFIRMED" && !profile.tp3Declaration.sourceReference) {
    reasons.push("Add the accepted TP3 declaration reference.");
  }
  return reasons.length
    ? { status: "REVIEW_REQUIRED", reasons }
    : { status: "READY", reasons: [] };
}

export function parseEmployeePcbProfile(value: Prisma.JsonValue | null | undefined) {
  const parsed = pcbProfileDataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function pcbProfileToJson(profile: EmployeePcbProfile): Prisma.InputJsonValue {
  return profile as unknown as Prisma.InputJsonValue;
}
