import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { DATABASE_URL } from "./embedded-postgres-utils.mjs";

const configuredUrl = process.env.DATABASE_URL ?? DATABASE_URL;
const hostname = new URL(configuredUrl).hostname;
if (!["localhost", "127.0.0.1"].includes(hostname)) {
  throw new Error("Auth QA account operations are restricted to Local database.");
}

process.env.DATABASE_URL = configuredUrl;
const prisma = new PrismaClient();
const action = process.argv[2];
const qaEmails = [
  "auth-qa-salon-owner@test.local",
  "auth-qa-salon-manager@test.local",
  "auth-qa-salon-cashier@test.local",
  "auth-qa-auto-owner@test.local",
];

try {
  if (action === "create") {
    const password = process.env.LOCAL_AUTH_QA_PASSWORD;
    if (!password || password.length < 12) {
      throw new Error("LOCAL_AUTH_QA_PASSWORD must contain at least 12 characters.");
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const [salon, auto] = await Promise.all([
      prisma.business.findFirstOrThrow({
        where: { name: "QA SALON 35b0d691", status: "active" },
        include: { branches: { where: { status: "ACTIVE" }, take: 1 } },
      }),
      prisma.business.findFirstOrThrow({
        where: { name: "QA AUTO 35b0d691", status: "active" },
        include: { branches: { where: { status: "ACTIVE" }, take: 1 } },
      }),
    ]);
    const salonBranch = salon.branches[0];
    const autoBranch = auto.branches[0];
    if (!salonBranch || !autoBranch) throw new Error("QA branch is unavailable.");

    const definitions = [
      {
        email: qaEmails[0],
        name: "AUTH QA Salon Owner",
        businessId: salon.id,
        branchId: salonBranch.id,
        role: "BUSINESS_OWNER",
        permissions: [],
      },
      {
        email: qaEmails[1],
        name: "AUTH QA Salon Manager",
        businessId: salon.id,
        branchId: salonBranch.id,
        role: "STAFF",
        permissions: [
          "ALL_BRANCHES",
          "CRM",
          "LOYALTY",
          "APPOINTMENTS",
          "POS",
          "INVOICES",
          "CLOSING",
          "TEAM",
          "REPORTS",
        ],
      },
      {
        email: qaEmails[2],
        name: "AUTH QA Salon Cashier",
        businessId: salon.id,
        branchId: salonBranch.id,
        role: "STAFF",
        permissions: ["CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING"],
      },
      {
        email: qaEmails[3],
        name: "AUTH QA Auto Owner",
        businessId: auto.id,
        branchId: autoBranch.id,
        role: "BUSINESS_OWNER",
        permissions: [],
      },
    ];

    for (const definition of definitions) {
      await prisma.user.upsert({
        where: { email: definition.email },
        create: {
          ...definition,
          passwordHash,
          loginEnabled: true,
          status: "active",
        },
        update: {
          ...definition,
          passwordHash,
          loginEnabled: true,
          status: "active",
        },
      });
    }
    console.log(JSON.stringify({ created: qaEmails }, null, 2));
  } else if (action === "revoke-cashier-pos") {
    await prisma.user.update({
      where: { email: qaEmails[2] },
      data: { permissions: ["CRM", "APPOINTMENTS", "INVOICES", "CLOSING"] },
    });
    console.log(JSON.stringify({ updated: qaEmails[2], pos: false }));
  } else if (action === "restore-cashier-pos") {
    await prisma.user.update({
      where: { email: qaEmails[2] },
      data: { permissions: ["CRM", "APPOINTMENTS", "POS", "INVOICES", "CLOSING"] },
    });
    console.log(JSON.stringify({ updated: qaEmails[2], pos: true }));
  } else if (action === "cleanup") {
    const users = await prisma.user.findMany({
      where: { email: { in: qaEmails } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (userIds.length) {
      await prisma.authSecurityEvent.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    console.log(JSON.stringify({ removed: userIds.length }));
  } else {
    throw new Error("Use create, revoke-cashier-pos, restore-cashier-pos, or cleanup.");
  }
} finally {
  await prisma.$disconnect();
}
