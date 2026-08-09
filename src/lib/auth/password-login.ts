import bcrypt from "bcryptjs";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AuthRequestContext } from "./security";
import {
  acquirePasswordLoginRateLimitLocks,
  authSecurityHashes,
  checkPasswordLoginRateLimit,
  PASSWORD_LOGIN_SURFACE,
  writeAuthSecurityEvent,
} from "./security";

const DUMMY_PASSWORD_HASH =
  "$2b$12$7RkQu4sQ3I6VIDho30B2RedmT6muQwFEWfHqZKpDVNjHV0y8MnV.C";

type PasswordLoginTransaction = Pick<
  Prisma.TransactionClient,
  "user" | "authSecurityEvent" | "$queryRaw"
>;

type PasswordLoginDatabase = Pick<PrismaClient, "$transaction">;

export type PasswordLoginResult =
  | Readonly<{
      ok: true;
      user: NonNullable<Awaited<ReturnType<typeof findPasswordLoginUser>>> & {
        email: string;
        passwordHash: string;
      };
    }>
  | Readonly<{
      ok: false;
      code: "INVALID_CREDENTIALS" | "RATE_LIMITED";
    }>;

export async function authenticatePasswordLogin(
  input: {
    email: string;
    password: string;
    request: AuthRequestContext;
  },
  dependencies: {
    database?: PasswordLoginDatabase;
    now?: Date;
  } = {},
): Promise<PasswordLoginResult> {
  const database = dependencies.database ?? prisma;
  const now = dependencies.now ?? new Date();
  const email = input.email.trim().toLowerCase();
  const hashes = authSecurityHashes({
    identifier: email,
    ipAddress: input.request.ipAddress,
    userAgent: input.request.userAgent,
  });

  return database.$transaction(
    async (transaction: PasswordLoginTransaction) => {
      await acquirePasswordLoginRateLimitLocks(hashes, transaction);
      const limit = await checkPasswordLoginRateLimit(
        {
          identifierHash: hashes.identifierHash,
          ipAddressHash: hashes.ipAddressHash,
          now,
        },
        transaction,
      );

      if (!limit.allowed) {
        await writeAuthSecurityEvent(
          {
            eventType: "LOGIN_RATE_LIMITED",
            surface: PASSWORD_LOGIN_SURFACE,
            outcome: "RATE_LIMITED",
            ...hashes,
            reason: limit.reasons.join("+"),
            createdAt: now,
          },
          transaction,
        );
        return { ok: false as const, code: "RATE_LIMITED" as const };
      }

      const user = await findPasswordLoginUser(email, transaction);
      const usable = Boolean(
        user &&
          user.status === "active" &&
          user.loginEnabled &&
          user.email &&
          user.passwordHash &&
          (!user.business || user.business.status === "active"),
      );
      const passwordValid = await bcrypt.compare(
        input.password,
        usable && user?.passwordHash ? user.passwordHash : DUMMY_PASSWORD_HASH,
      );

      if (!usable || !user || !passwordValid) {
        await writeAuthSecurityEvent(
          {
            eventType: "LOGIN_FAILED",
            surface: PASSWORD_LOGIN_SURFACE,
            outcome: "FAILURE",
            ...hashes,
            userId: user?.id ?? null,
            businessId: user?.businessId ?? null,
            reason: "INVALID_CREDENTIALS",
            createdAt: now,
          },
          transaction,
        );
        return { ok: false as const, code: "INVALID_CREDENTIALS" as const };
      }

      if (!user.email || !user.passwordHash) {
        throw new Error("Authenticated password user is incomplete.");
      }

      await writeAuthSecurityEvent(
        {
          eventType: "LOGIN_SUCCESS",
          surface: PASSWORD_LOGIN_SURFACE,
          outcome: "SUCCESS",
          ...hashes,
          userId: user.id,
          businessId: user.businessId,
          createdAt: now,
        },
        transaction,
      );

      return {
        ok: true as const,
        user: {
          ...user,
          email: user.email,
          passwordHash: user.passwordHash,
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function findPasswordLoginUser(
  email: string,
  database: Pick<PasswordLoginTransaction, "user">,
) {
  return database.user.findUnique({
    where: { email },
    include: { business: true },
  });
}
