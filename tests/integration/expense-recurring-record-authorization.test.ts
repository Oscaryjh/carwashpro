import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { createRecurringExpenseTemplate, generateRecurringExpense, updateRecurringExpenseTemplate } from "../../src/lib/expense/service";

test("recurring records authorize source, destination and fresh replay before database mutation", async (t) => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.notEqual(url.port, "5432");
  assert.match(url.pathname, /^\/tetamu_final_sweep_disposable_\d+$/);
  const writes: string[] = [];
  const db = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  db.$on("query", (event) => { if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(event.query)) writes.push(event.query); });
  const key = () => `RECURRING-RECORD:${randomUUID()}`;
  try {
    const business = await db.business.create({ data: { name: "Synthetic recurring authorization", slug: randomUUID() } });
    const foreign = await db.business.create({ data: { name: "Synthetic foreign", slug: randomUUID() } });
    const a = await db.branch.create({ data: { businessId: business.id, name: "A" } });
    const b = await db.branch.create({ data: { businessId: business.id, name: "B" } });
    const x = await db.branch.create({ data: { businessId: foreign.id, name: "X" } });
    const owner = await db.user.create({ data: { businessId: business.id, role: "BUSINESS_OWNER", name: "Owner", email: `${randomUUID()}@example.test` } });
    const staff = await db.user.create({ data: { businessId: business.id, branchId: a.id, role: "STAFF", permissions: ["EXPENSE_CATEGORY_MANAGE", "EXPENSE_CREATE"], name: "Staff A", email: `${randomUUID()}@example.test` } });
    const outsider = await db.user.create({ data: { businessId: foreign.id, role: "BUSINESS_OWNER", name: "Foreign Owner", email: `${randomUUID()}@example.test` } });
    const category = await db.expenseCategory.create({ data: { businessId: business.id, name: "Operations" } });
    const foreignCategory = await db.expenseCategory.create({ data: { businessId: foreign.id, name: "Foreign operations" } });
    const actor = (u: typeof owner) => { assert.ok(u.email); return { userId: u.id, name: u.name, email: u.email }; };
    async function template(branchId: string | null, foreignScope = false) {
      return createRecurringExpenseTemplate({ actor: actor(foreignScope ? outsider : owner), businessId: foreignScope ? foreign.id : business.id, branchId, categoryId: foreignScope ? foreignCategory.id : category.id, amount: "13", description: "Synthetic monthly expense", startDate: "2026-01-01", operationKey: key() }, db);
    }
    const update = (row: Awaited<ReturnType<typeof template>>, user = staff, branchId = row.branchId) => ({ actor: actor(user), businessId: business.id, templateId: row.id, branchId, categoryId: category.id, active: true, amount: "13", description: "Updated description", startDate: "2026-01-01", expectedRevision: row.revision, reason: "Synthetic revision", operationKey: key() });
    const generate = (row: Awaited<ReturnType<typeof template>>, user = staff) => ({ actor: actor(user), businessId: business.id, templateId: row.id, period: "2026-10", operationKey: key() });
    async function snapshot() {
      return Promise.all([db.recurringExpenseTemplate.findMany({ orderBy: { id: "asc" } }), db.businessExpense.findMany({ orderBy: { id: "asc" } }), db.expenseCommand.count(), db.auditLog.count(), db.business.findMany({ select: { id: true, expenseSequence: true }, orderBy: { id: "asc" } }), db.payment.count(), db.invoice.count()]);
    }
    async function denied(run: () => Promise<unknown>, pattern = /authoris|scope|not found/i) {
      const before = await snapshot(); const n = writes.length;
      await assert.rejects(run, pattern);
      assert.deepEqual(await snapshot(), before);
      assert.equal(writes.length, n, "no mutation SQL may run before source rejection");
    }
    await t.test("Staff updates A same-scope and non-scope facts", async () => {
      const row = await template(a.id); const result = await updateRecurringExpenseTemplate(update(row), db);
      assert.equal(result.branchId, a.id); assert.equal(result.defaultDescription, "Updated description"); assert.equal(result.revision, 1);
    });
    for (const destination of [a.id, b.id, null]) await t.test(`Staff cannot wash source B into ${destination ?? "Business-wide"}`, async () => {
      const row = await template(b.id); await denied(() => updateRecurringExpenseTemplate(update(row, staff, destination), db));
    });
    await t.test("Staff A cannot relocate own A to B or foreign X", async () => {
      const row = await template(a.id);
      for (const destination of [b.id, x.id]) await denied(() => updateRecurringExpenseTemplate(update(row, staff, destination), db));
    });
    await t.test("Owner can update B and relocate A to B", async () => {
      for (const source of [a.id, b.id]) { const row = await template(source); assert.equal((await updateRecurringExpenseTemplate(update(row, owner, b.id), db)).branchId, b.id); }
    });
    await t.test("Business-wide remains null for Owner and rejects Staff update/generate", async () => {
      const row = await template(null); await denied(() => updateRecurringExpenseTemplate(update(row, staff, a.id), db));
      await denied(() => generateRecurringExpense(generate(row), db));
      assert.equal((await updateRecurringExpenseTemplate(update(row, owner, null), db)).branchId, null);
      assert.equal((await generateRecurringExpense(generate(row, owner), db)).branchId, null);
    });
    await t.test("Cross-Business source update/generate disclose no result and write nothing", async () => {
      const row = await template(x.id, true);
      await denied(() => updateRecurringExpenseTemplate(update(row, staff, a.id), db));
      await denied(() => generateRecurringExpense(generate(row), db));
    });
    await t.test("Stale revision still rejects after valid source authorization", async () => {
      const row = await template(a.id); await updateRecurringExpenseTemplate(update(row), db);
      await denied(() => updateRecurringExpenseTemplate(update(row), db), /updated|refresh/i);
    });
    await t.test("Authorized exact Update replay returns existing revision without additional mutation", async () => {
      const row = await template(a.id); const input = update(row);
      const first = await updateRecurringExpenseTemplate(input, db);
      const before = await snapshot(); const n = writes.length;
      const replay = await updateRecurringExpenseTemplate(input, db);
      assert.equal(replay.id, first.id); assert.equal(replay.revision, 1);
      assert.deepEqual(await snapshot(), before); assert.equal(writes.length, n);
    });
    await t.test("Staff assigned Branch becoming inactive rejects update and generate", async () => {
      const row = await template(a.id); await db.branch.update({ where: { id: a.id }, data: { status: "INACTIVE" } });
      try { await denied(() => updateRecurringExpenseTemplate(update(row), db)); await denied(() => generateRecurringExpense(generate(row), db)); }
      finally { await db.branch.update({ where: { id: a.id }, data: { status: "ACTIVE" } }); }
    });
    await t.test("Staff cannot generate B; Owner B generation preserves unpaid Draft amount", async () => {
      const row = await template(b.id); await denied(() => generateRecurringExpense(generate(row), db));
      const result = await generateRecurringExpense(generate(row, owner), db);
      assert.equal(result.branchId, b.id); assert.equal(result.status, "DRAFT"); assert.equal(result.paymentStatus, "UNPAID"); assert.equal(result.amount.toFixed(2), "13.00");
    });
    await t.test("Authorized generation and same/new-key replay return exactly one Expense", async () => {
      const row = await template(a.id); const input = generate(row); const first = await generateRecurringExpense(input, db);
      assert.equal((await generateRecurringExpense(input, db)).id, first.id);
      assert.equal((await generateRecurringExpense({ ...input, operationKey: key() }, db)).id, first.id);
      assert.equal(await db.businessExpense.count({ where: { recurringTemplateId: row.id } }), 1);
    });
    await t.test("Fresh permission revocation rejects update/generate including saved replays", async () => {
      const row = await template(a.id); const generation = generate(row); await generateRecurringExpense(generation, db);
      const revision = update(row); await updateRecurringExpenseTemplate(revision, db);
      await db.user.update({ where: { id: staff.id }, data: { permissions: [] } });
      try {
        await denied(() => generateRecurringExpense(generation, db));
        await denied(() => generateRecurringExpense({ ...generation, operationKey: key() }, db));
        await denied(() => updateRecurringExpenseTemplate(revision, db));
      } finally { await db.user.update({ where: { id: staff.id }, data: { permissions: ["EXPENSE_CATEGORY_MANAGE", "EXPENSE_CREATE"] } }); }
    });
    await t.test("Fresh assignment change rejects first execution and replay", async () => {
      const row = await template(a.id); const input = generate(row); await generateRecurringExpense(input, db);
      await db.user.update({ where: { id: staff.id }, data: { branchId: b.id } });
      try { await denied(() => generateRecurringExpense(input, db)); await denied(() => updateRecurringExpenseTemplate(update(row, staff, b.id), db)); }
      finally { await db.user.update({ where: { id: staff.id }, data: { branchId: a.id } }); }
    });
    await t.test("Template relocated A to B rejects stale page update/generate/replay", async () => {
      const row = await template(a.id); const input = generate(row); await generateRecurringExpense(input, db);
      await updateRecurringExpenseTemplate(update(row, owner, b.id), db);
      await denied(() => updateRecurringExpenseTemplate(update(row, staff, a.id), db));
      await denied(() => generateRecurringExpense(input, db));
      await denied(() => generateRecurringExpense({ ...input, operationKey: key() }, db));
    });
    await t.test("Returning old B Expense after Owner moved template to A is denied to Staff A", async () => {
      const row = await template(b.id); const input = generate(row, owner); await generateRecurringExpense(input, db);
      await updateRecurringExpenseTemplate(update(row, owner, a.id), db);
      await denied(() => generateRecurringExpense({ ...input, actor: actor(staff) }, db));
      await denied(() => generateRecurringExpense({ ...input, actor: actor(staff), operationKey: key() }, db));
    });
    await t.test("Staff cannot replay Owner B operation; cross-Business replay denied", async () => {
      const row = await template(b.id); const input = generate(row, owner); await generateRecurringExpense(input, db);
      await denied(() => generateRecurringExpense({ ...input, actor: actor(staff) }, db));
      await denied(() => generateRecurringExpense({ ...input, actor: actor(outsider), businessId: foreign.id }, db));
    });
    await t.test("Inactive historical Branch permits existing Owner generation, never Staff fallback", async () => {
      const row = await template(b.id); await db.branch.update({ where: { id: b.id }, data: { status: "INACTIVE" } });
      try { await denied(() => generateRecurringExpense(generate(row), db)); assert.equal((await generateRecurringExpense(generate(row, owner), db)).branchId, b.id); }
      finally { await db.branch.update({ where: { id: b.id }, data: { status: "ACTIVE" } }); }
    });
    await t.test("Concurrent duplicate keeps one Expense under existing Serializable contract", async () => {
      const row = await template(a.id); const input = generate(row);
      const results = await Promise.allSettled([generateRecurringExpense(input, db), generateRecurringExpense(input, db)]);
      assert.ok(results.some(r => r.status === "fulfilled"));
      for (const result of results) if (result.status === "rejected") assert.match(String(result.reason), /write conflict|deadlock|P2034|unique constraint/i);
      assert.equal(await db.businessExpense.count({ where: { recurringTemplateId: row.id } }), 1);
      assert.ok(await generateRecurringExpense(input, db));
    });
    assert.equal(await db.payment.count(), 0); assert.equal(await db.invoice.count(), 0);
  } finally { await db.$disconnect(); }
});
