import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateStatutoryContributions,
  lookupEpfSchedule,
} from "../../src/lib/payroll/statutory";

const periodEnd = new Date("2026-08-01T00:00:00.000Z");

test("official schedules match the published RM3,250 examples and bands", () => {
  const result = calculateStatutoryContributions({
    profile: {
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      statutoryNationality: "MALAYSIAN",
      epfEnabled: true,
      epfMemberBeforeAug1998: false,
      socsoEnabled: true,
      socsoCategory: "FIRST",
      eisEnabled: true,
      eisPreviouslyContributed: false,
      lindung24OptIn: true,
    },
    payrollPeriodEnd: periodEnd,
    epfWageCents: 325_000,
    perkesoWageCents: 325_000,
  });

  assert.equal(result.status, "AUTO_CALCULATED");
  assert.equal(result.employerEpfCents, 42_400);
  assert.equal(result.epfEmployeeCents, 35_900);
  assert.equal(result.employerSocsoCents, 5_685);
  assert.equal(result.socsoEmployeeCents, 1_625);
  assert.equal(result.lindung24EmployeeCents, 2_435);
  assert.equal(result.employerEisCents, 650);
  assert.equal(result.eisEmployeeCents, 650);
});

test("PERKESO schedules cap contributions at the RM6,000 wage ceiling", () => {
  const result = calculateStatutoryContributions({
    profile: {
      dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
      statutoryNationality: "MALAYSIAN",
      epfEnabled: false,
      epfMemberBeforeAug1998: false,
      socsoEnabled: true,
      socsoCategory: "FIRST",
      eisEnabled: true,
      eisPreviouslyContributed: false,
      lindung24OptIn: false,
    },
    payrollPeriodEnd: periodEnd,
    epfWageCents: 700_000,
    perkesoWageCents: 700_000,
  });

  assert.equal(result.employerSocsoCents, 10_415);
  assert.equal(result.socsoEmployeeCents, 2_975);
  assert.equal(result.lindung24EmployeeCents, 0);
  assert.equal(result.employerEisCents, 1_190);
  assert.equal(result.eisEmployeeCents, 1_190);
});

test("non-Malaysian EPF Part F uses the official direct method", () => {
  assert.deepEqual(
    lookupEpfSchedule({
      age: 30,
      nationality: "NON_MALAYSIAN",
      memberBeforeAug1998: false,
      wageCents: 175_100,
    }),
    { employerCents: 3_600, employeeCents: 3_600 },
  );
});

test("Malaysian employees aged 60 use EPF Part E", () => {
  assert.deepEqual(
    lookupEpfSchedule({
      age: 60,
      nationality: "MALAYSIAN",
      memberBeforeAug1998: false,
      wageCents: 325_000,
    }),
    { employerCents: 13_100, employeeCents: 0 },
  );
});

test("incomplete statutory profiles are never guessed", () => {
  const result = calculateStatutoryContributions({
    profile: {
      dateOfBirth: null,
      statutoryNationality: null,
      epfEnabled: true,
      epfMemberBeforeAug1998: false,
      socsoEnabled: true,
      socsoCategory: null,
      eisEnabled: true,
      eisPreviouslyContributed: false,
      lindung24OptIn: false,
    },
    payrollPeriodEnd: periodEnd,
    epfWageCents: 325_000,
    perkesoWageCents: 325_000,
  });

  assert.equal(result.status, "REVIEW_REQUIRED");
  assert.equal(result.epfEmployeeCents, 0);
  assert.equal(result.socsoEmployeeCents, 0);
  assert.equal(result.eisEmployeeCents, 0);
  assert.ok(result.warnings.length >= 3);
});

test("EPF schedule treats wages up to RM10 as nil", () => {
  assert.deepEqual(
    lookupEpfSchedule({
      age: 30,
      nationality: "MALAYSIAN",
      memberBeforeAug1998: false,
      wageCents: 1_000,
    }),
    { employerCents: 0, employeeCents: 0 },
  );
});

test("EPF schedule starts at the first official band above RM10", () => {
  assert.deepEqual(
    lookupEpfSchedule({
      age: 30,
      nationality: "MALAYSIAN",
      memberBeforeAug1998: false,
      wageCents: 1_001,
    }),
    { employerCents: 300, employeeCents: 300 },
  );
});
