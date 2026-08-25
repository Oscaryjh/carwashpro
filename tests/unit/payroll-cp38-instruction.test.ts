import assert from "node:assert/strict";
import test from "node:test";
import {
  CP38_BLOCKERS,
  cp38InstructionSourceDigest,
  recordCp38Instruction,
  resolveCp38ForPeriod,
  type Cp38InstructionRecord,
} from "../../src/lib/payroll/cp38-instruction";

const record = (
  overrides: Partial<Cp38InstructionRecord> = {},
): Cp38InstructionRecord => ({
  id: "instruction-1",
  instructionReference: "CP38-2026-001",
  effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
  effectiveToMonth: null,
  monthlyAmount: { toString: () => "125.40" },
  status: "ACTIVE",
  revision: 1,
  evidenceReference: "LHDN instruction CP38-2026-001",
  sourceDigest: "source-digest",
  ...overrides,
});

test("CP38 resolves to zero only when no instruction applies", () => {
  assert.deepEqual(resolveCp38ForPeriod([], new Date("2026-08-01T00:00:00.000Z")), {
    status: "CLEAR",
    amountCents: 0,
    instructions: [],
  });
  assert.equal(
    resolveCp38ForPeriod(
      [record({ effectiveFromMonth: new Date("2026-09-01T00:00:00.000Z") })],
      new Date("2026-08-01T00:00:00.000Z"),
    ).status,
    "CLEAR",
  );
});

test("CP38 uses the instructed amount without calculating a formula", () => {
  const resolved = resolveCp38ForPeriod(
    [record()],
    new Date("2026-08-01T00:00:00.000Z"),
  );
  assert.equal(resolved.status, "APPLICABLE");
  if (resolved.status !== "APPLICABLE") return;
  assert.equal(resolved.amountCents, 12_540);
  assert.equal(resolved.instructions[0]?.instructionReference, "CP38-2026-001");
});

test("duplicate active revisions for one CP38 reference fail closed", () => {
  const resolved = resolveCp38ForPeriod(
    [record(), record({ id: "instruction-2", revision: 2 })],
    new Date("2026-08-01T00:00:00.000Z"),
  );
  assert.deepEqual(resolved, {
    status: "BLOCKED",
    blocker: CP38_BLOCKERS.AMBIGUOUS_ACTIVE_REVISION,
  });
});

test("invalid stored CP38 amount is rejected", () => {
  assert.throws(
    () => resolveCp38ForPeriod(
      [record({ monthlyAmount: { toString: () => "0.00" } })],
      new Date("2026-08-01T00:00:00.000Z"),
    ),
    new RegExp(CP38_BLOCKERS.INVALID_AMOUNT),
  );
});

test("CP38 revisions close the old active instruction and retain a digest", async () => {
  const calls: Array<{ method: string; args: unknown }> = [];
  const database = {
    employeeCp38Instruction: {
      findFirst: async (args: unknown) => {
        calls.push({ method: "findFirst", args });
        return null;
      },
      updateMany: async (args: unknown) => {
        calls.push({ method: "updateMany", args });
        return { count: 0 };
      },
      create: async (args: unknown) => {
        calls.push({ method: "create", args });
        return args;
      },
    },
  };
  const input = {
    businessId: "00000000-0000-4000-8000-000000000001",
    membershipId: "00000000-0000-4000-8000-000000000002",
    instructionReference: "CP38-2026-001",
    effectiveFromMonth: new Date("2026-08-19T00:00:00.000Z"),
    effectiveToMonth: null,
    monthlyAmountCents: 12_540,
    evidenceReference: "LHDN instruction CP38-2026-001",
    revision: 1,
    recordedById: "00000000-0000-4000-8000-000000000003",
  };
  await recordCp38Instruction(database, input);
  assert.equal(calls.map((call) => call.method).join(","), "findFirst,updateMany,create");
  const digest = cp38InstructionSourceDigest({
    ...input,
    effectiveFromMonth: new Date("2026-08-01T00:00:00.000Z"),
  });
  const create = calls.find((call) => call.method === "create")?.args as {
    data: { sourceDigest: string; monthlyAmount: string; effectiveFromMonth: Date };
  };
  assert.equal(create.data.sourceDigest, digest);
  assert.equal(create.data.monthlyAmount, "125.40");
  assert.equal(create.data.effectiveFromMonth.toISOString(), "2026-08-01T00:00:00.000Z");
});
