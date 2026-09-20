import assert from "node:assert/strict";
import test from "node:test";
import * as peoplePresentation from "../../src/lib/team/people-presentation";
import * as uatContract from "../../scripts/hr-payroll-eight-role-uat-contract";

type DetailPathResolver = (input: {
  canManageAttendanceEmployees: boolean;
  canViewTeamDirectory: boolean;
  employeeId: string;
}) => string | null;

type NavigationDenialClassifier = (input: {
  allowedFallbackPaths: readonly string[];
  bodyText: string;
  finalPath: string;
  requestedPath: string;
  status: number | null;
}) => boolean;

type ExactNavigationClassifier = (input: {
  finalPath: string;
  requestedPath: string;
  status: number | null;
}) => boolean;

test("Attendance manager employee links open the branch-scoped attendance detail route", () => {
  const resolver = Reflect.get(
    peoplePresentation,
    "employeeDirectoryDetailPath",
  ) as DetailPathResolver | undefined;
  assert.equal(typeof resolver, "function");
  assert.equal(
    resolver?.({
      canManageAttendanceEmployees: true,
      canViewTeamDirectory: false,
      employeeId: "11111111-1111-4111-8111-111111111111",
    }),
    "/team/employees/11111111-1111-4111-8111-111111111111",
  );
});

test("Directory readers retain the canonical employee profile route", () => {
  const resolver = Reflect.get(
    peoplePresentation,
    "employeeDirectoryDetailPath",
  ) as DetailPathResolver | undefined;
  assert.equal(typeof resolver, "function");
  assert.equal(
    resolver?.({
      canManageAttendanceEmployees: true,
      canViewTeamDirectory: true,
      employeeId: "22222222-2222-4222-8222-222222222222",
    }),
    "/team/people/22222222-2222-4222-8222-222222222222",
  );
});

test("UAT own-detail assertion rejects a redirect back to the employee list", () => {
  const exact = Reflect.get(
    uatContract,
    "isExactHrPayrollUatNavigation",
  ) as ExactNavigationClassifier | undefined;
  assert.equal(typeof exact, "function");
  assert.equal(
    exact?.({
      requestedPath: "/team/employees/33333333-3333-4333-8333-333333333333",
      finalPath: "/team/employees",
      status: 200,
    }),
    false,
  );
  assert.equal(
    exact?.({
      requestedPath: "/team/employees/33333333-3333-4333-8333-333333333333",
      finalPath: "/team/employees/33333333-3333-4333-8333-333333333333",
      status: 200,
    }),
    true,
  );
});

test("UAT denial assertion accepts only an explicitly allowlisted fail-closed fallback", () => {
  const denied = Reflect.get(
    uatContract,
    "isHrPayrollUatDeniedNavigation",
  ) as NavigationDenialClassifier | undefined;
  assert.equal(typeof denied, "function");
  const base = {
    requestedPath: "/team/employees/44444444-4444-4444-8444-444444444444",
    bodyText: "Employees",
    status: 200,
    allowedFallbackPaths: ["/team/employees"],
  } as const;
  assert.equal(denied?.({ ...base, finalPath: "/team/employees" }), true);
  assert.equal(denied?.({ ...base, finalPath: "/team/claims" }), false);
});
