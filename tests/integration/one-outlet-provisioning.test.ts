import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { prisma } from "../../src/lib/prisma";
import { resolveBusinessAccess } from "../../src/lib/business-groups/business-access";

test("actual createBusinessAction provisions one internal branch and independent owners without implicit group access", async () => {
  assert.match(process.env.DATABASE_URL ?? "", /localhost:5432\/.*_disposable_/);
  const suffix = randomUUID();
  const actor = await prisma.user.create({ data: { name: "Synthetic platform admin", email: `outlet-admin-${suffix}@example.test`, role: "PLATFORM_ADMIN" } });
  const session = { userId: actor.id, name: actor.name, email: actor.email, role: actor.role, status: actor.status, permissions: [], branchId: null };
  // Only framework request/redirect plumbing is substituted. The production action,
  // role check, transaction, password hashing, provisioning and audit use real code/DB.
  const cache = join(process.cwd(), "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const temporary = await mkdtemp(join(cache, "one-outlet-action-"));
  const outfile = join(temporary, "action.cjs");
  try {
    await build({
      entryPoints: ["src/app/admin/businesses/actions.ts"], outfile,
      platform: "node", format: "cjs", bundle: true, packages: "external", logLevel: "silent",
      plugins: [{ name: "request-boundaries", setup(builder) {
        builder.onResolve({ filter: /^(?:@\/lib\/auth\/session|next\/(?:headers|cache|navigation))$/ }, (args) => ({ path: args.path, namespace: "request-boundary" }));
        builder.onLoad({ filter: /.*/, namespace: "request-boundary" }, (args) => ({ contents:
          args.path === "@/lib/auth/session" ? `export async function requireUser(){return ${JSON.stringify(session)}}; export function revokeUserSessions(){throw Error('unexpected revoke')}` :
          args.path === "next/headers" ? "export async function headers(){return new Headers()}; export async function cookies(){throw Error('unexpected cookies')}" :
          args.path === "next/cache" ? "export function revalidatePath(){}" :
          "export function redirect(url){throw Error('TEST_REDIRECT:'+url)}; export function notFound(){throw Error('TEST_NOT_FOUND')}"
        }));
      } }],
    });
    const { createBusinessAction } = createRequire(import.meta.url)(outfile);
    const businesses = [];
    for (const outlet of ["Lintas", "Damai"]) {
      const name = `A Salon ${outlet} ${suffix}`;
      const slug = `outlet-${outlet.toLowerCase()}-${suffix}`;
      const form = new FormData();
      for (const [key, value] of Object.entries({ name, slug, industryType: "SALON_BEAUTY", companyNo: "", phone: "", address: `Synthetic ${outlet} address`, ownerName: `${outlet} Owner`, ownerEmail: `${slug}@example.test`, ownerPassword: "synthetic-only-password" })) form.set(key, value);
      await assert.rejects(createBusinessAction({ status: "idle", message: "" }, form), /TEST_REDIRECT:/);
      const business = await prisma.business.findUniqueOrThrow({ where: { slug }, include: { branches: true, users: true } });
      assert.equal(business.address, `Synthetic ${outlet} address`);
      assert.equal(business.branches.length, 1);
      assert.equal(business.branches[0].name, name);
      assert.equal(business.branches[0].status, "ACTIVE");
      assert.equal(business.users.length, 1);
      assert.equal(business.users[0].role, "BUSINESS_OWNER");
      assert.equal(business.users[0].branchId, business.branches[0].id);
      assert.equal(await prisma.branchAttendanceSetting.count({ where: { businessId: business.id } }), 0);
      assert.equal(await prisma.auditLog.count({ where: { businessId: business.id, action: "BUSINESS_CREATED" } }), 1);
      assert.equal(await prisma.auditLog.count({ where: { businessId: business.id, action: "BRANCH_CREATED" } }), 1);
      assert.ok(await prisma.businessModuleEntitlement.count({ where: { businessId: business.id } }));
      // An ordinary retry is rejected by the existing slug/email uniqueness guard.
      const duplicate = await createBusinessAction({ status: "idle", message: "" }, form);
      assert.equal(duplicate.status, "error");
      assert.equal(await prisma.branch.count({ where: { businessId: business.id } }), 1);
      businesses.push(business);
    }
    const group = await prisma.businessGroup.create({ data: { name: `Synthetic group ${suffix}`, code: `outlet-${suffix}` } });
    await prisma.businessGroupMember.createMany({ data: businesses.map((business) => ({ businessId: business.id, groupId: group.id })) });
    for (const [index, business] of businesses.entries()) {
      const owner = business.users[0];
      assert.equal(await prisma.businessGroupUser.count({ where: { userId: owner.id } }), 0);
      for (const capability of ["VIEW_CRM", "VIEW_INVOICES", "PROCESS_CASHIER_PAYMENT", "VIEW_ATTENDANCE_EMPLOYEES"] as const) {
        assert.equal((await resolveBusinessAccess({ userId: owner.id, requestedBusinessId: business.id, capability })).granted, true);
        assert.equal((await resolveBusinessAccess({ userId: owner.id, requestedBusinessId: businesses[1 - index].id, capability })).granted, false);
      }
    }
    await prisma.businessGroupUser.create({ data: { userId: businesses[0].users[0].id, groupId: group.id, role: "GROUP_OWNER", accessScope: "ALL_GROUP_BUSINESSES" } });
    assert.equal((await resolveBusinessAccess({ userId: businesses[0].users[0].id, requestedBusinessId: businesses[1].id, capability: "VIEW_REPORTS" })).granted, true);
  } finally {
    // This directory was generated by this test; disposable DB owns all fixtures.
    await rm(temporary, { recursive: true, force: true });
    await prisma.$disconnect();
  }
});
