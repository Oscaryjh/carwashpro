import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public";
const businessId = process.argv[2];
const attendanceId = process.argv[3];
const leaveId = process.argv[4];
const commissionPeriodId = process.argv[5];
if (!businessId || !attendanceId || !leaveId || !commissionPeriodId) throw new Error("Fixture identity arguments are required.");
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname.toLowerCase())) throw new Error("Verification is Local only.");
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient();

async function main() {
  const [attendance, leave, commission, audit] = await Promise.all([
    prisma.attendanceP2Exception.findFirstOrThrow({ where: { id: attendanceId, businessId }, select: { status: true, revision: true } }),
    prisma.leaveRequest.findFirstOrThrow({ where: { id: leaveId, businessId }, select: { status: true, revision: true, payTreatmentSnapshot: true } }),
    prisma.commissionPeriod.findFirstOrThrow({ where: { id: commissionPeriodId, businessId }, select: { status: true, currentRevision: true } }),
    prisma.auditLog.findMany({
      where: {
        businessId,
        entityId: { in: [attendanceId, leaveId, commissionPeriodId] },
      },
      select: { action: true, entityId: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  process.stdout.write(JSON.stringify({ attendance, leave, commission, audit }, null, 2));
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
