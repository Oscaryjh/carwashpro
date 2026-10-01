import type { PrismaClient } from "@prisma/client";

/** Reuse a caller-owned transaction, or read the complete report in one read-only MVCC snapshot. */
export function financialReadSnapshot<Database extends object, Result>(database: Database, read: (tx: Database) => Promise<Result>): Promise<Result> {
  if (!("$transaction" in database)) return read(database);
  return (database as unknown as PrismaClient).$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return read(tx as unknown as Database);
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}
