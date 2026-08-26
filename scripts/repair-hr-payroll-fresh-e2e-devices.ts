import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { hashEmployeeIdentifier } from "../src/lib/attendance/employee-auth/crypto";
import { bindVerifiedEmployeeDevice } from "../src/lib/attendance/employee-auth/device-service";
import { createEmployeeSessionRecord } from "../src/lib/attendance/employee-auth/session";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("FRESH_E2E_DEVICE_REPAIR_FORBIDDEN_IN_PRODUCTION");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
  const host = new URL(databaseUrl).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) {
    throw new Error("FRESH_E2E_DEVICE_REPAIR_REQUIRES_LOCAL_DATABASE");
  }
  process.env.EMPLOYEE_AUTH_SECRET ??=
    "tetamu-local-development-employee-auth-secret-v1";

  const artifact = JSON.parse(
    await readFile(
      join(process.cwd(), ".tmp", "hr-payroll-fresh-e2e.json"),
      "utf8",
    ),
  ) as {
    environment: string;
    businessId: string;
    branchId: string;
    employee: {
      accountId: string;
      membershipId: string;
      sessionToken: string;
    };
  };
  if (artifact.environment !== "LOCAL FRESH E2E") {
    throw new Error("FRESH_E2E_ARTIFACT_REQUIRED");
  }

  const session = await prisma.$transaction(async (transaction) => {
    const device = await bindVerifiedEmployeeDevice(
      {
        employeeAccountId: artifact.employee.accountId,
        deviceIdentifierHash: hashEmployeeIdentifier(
          "device",
          `fresh-${artifact.employee.accountId}`,
        ),
        displayName: "Fresh Employee 001 UAT browser",
        platform: "Browser",
        browser: "Codex",
        now: new Date(),
        purpose: "REGISTER_DEVICE",
      },
      transaction,
    );
    return createEmployeeSessionRecord(
      {
        employeeAccountId: artifact.employee.accountId,
        membershipId: artifact.employee.membershipId,
        businessId: artifact.businessId,
        primaryBranchId: artifact.branchId,
        attendanceBranchId: artifact.branchId,
        deviceId: device.deviceId,
        now: new Date(),
        userAgent: "Tetamu Fresh E2E UAT device repair",
      },
      transaction,
    );
  });
  artifact.employee.sessionToken = session.token;
  const serialized = JSON.stringify(artifact, null, 2);
  await writeFile(
    join(process.cwd(), ".tmp", "hr-payroll-fresh-e2e.json"),
    serialized,
  );
  await writeFile(
    join(
      process.cwd(),
      "..",
      "CodexTetamuP0-staff-ui",
      ".tmp",
      "hr-payroll-fresh-e2e.json",
    ),
    serialized,
  );
  console.log(
    JSON.stringify({ environment: artifact.environment, registered: 1 }),
  );
}

main().finally(() => prisma.$disconnect());
