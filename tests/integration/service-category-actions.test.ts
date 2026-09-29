import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { prisma } from "../../src/lib/prisma";

test("manual service category lifecycle preserves required category, delete protection and tenant/permission isolation", async () => {
  assert.match(process.env.DATABASE_URL ?? "", /localhost:5432\/.*_disposable_/);
  const suffix = randomUUID();
  const business = await prisma.business.create({ data: { name: `Category test ${suffix}`, slug: `category-${suffix}`, industryType: "SALON_BEAUTY" } });
  const foreign = await prisma.business.create({ data: { name: `Foreign ${suffix}`, slug: `category-foreign-${suffix}`, industryType: "SALON_BEAUTY" } });
  const branch = await prisma.branch.create({ data: { businessId: business.id, name: "Only branch" } });
  const owner = await prisma.user.create({ data: { businessId: business.id, branchId: branch.id, name: "Synthetic owner", email: `category-${suffix}@example.test`, role: "BUSINESS_OWNER" } });
  const foreignCategory = await prisma.serviceCategory.create({ data: { businessId: foreign.id, name: "Foreign category" } });
  const context = { businessId: business.id, industryType: "SALON_BEAUTY", user: { userId: owner.id, businessId: business.id, role: "BUSINESS_OWNER", permissions: [] as string[] } };
  Object.assign(globalThis, { __categoryActionContext: context });
  const cache = join(process.cwd(), "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "category-actions-"));
  const form = (values: Record<string, string>) => { const data = new FormData(); for (const [key, value] of Object.entries(values)) data.set(key, value); return data; };
  try {
    for (const [name, entry] of [["categories", "src/app/(business)/services/categories/actions.ts"], ["services", "src/app/(business)/services/actions.ts"]]) {
      await build({ entryPoints: [entry], outfile: join(directory, `${name}.cjs`), bundle: true, platform: "node", format: "cjs", packages: "external", plugins: [{ name: "request-boundary", setup(b) {
        b.onResolve({ filter: /^(?:@\/lib\/auth\/business-user|next\/(?:navigation|cache))$/ }, args => ({ path: args.path, namespace: "request" }));
        b.onLoad({ filter: /.*/, namespace: "request" }, args => ({ contents: args.path.endsWith("business-user")
          ? "export async function requireBusinessUserForModule(){return globalThis.__categoryActionContext}"
          : args.path === "next/cache" ? "export function revalidatePath(){}"
          : "export function redirect(url){const e=new Error('REDIRECT:'+url);e.digest='NEXT_REDIRECT;replace;'+url+';307;';throw e}" }));
      } }] });
    }
    const require = createRequire(import.meta.url);
    const categories = require(join(directory, "categories.cjs"));
    const services = require(join(directory, "services.cjs"));
    assert.equal(await prisma.serviceCategory.count({ where: { businessId: business.id } }), 0);
    const serviceInput = { name: "Synthetic haircut", price: "10", durationMinutes: "30", branchId: branch.id };
    await assert.rejects(services.createServiceAction(form(serviceInput)), /valid category/);
    assert.equal(await prisma.service.count({ where: { businessId: business.id } }), 0);
    await assert.rejects(categories.createServiceCategoryAction(form({ name: "Merchant category" })), /Category%20created%20successfully/);
    const category = await prisma.serviceCategory.findFirstOrThrow({ where: { businessId: business.id } });
    await assert.rejects(services.createServiceAction(form({ ...serviceInput, categoryId: foreignCategory.id })), /No record|not found/i);
    await assert.rejects(services.createServiceAction(form({ ...serviceInput, categoryId: category.id })), /REDIRECT:\/services\//);
    const service = await prisma.service.findFirstOrThrow({ where: { businessId: business.id } });
    assert.equal(service.categoryId, category.id);
    assert.equal(service.category, "Merchant category");
    assert.equal(service.branchId, branch.id);
    await assert.rejects(categories.deleteServiceCategoryAction(form({ categoryId: category.id })), /Cannot%20delete/);
    assert.ok(await prisma.serviceCategory.findUnique({ where: { id: category.id } }));
    for (const status of ["INACTIVE", "ACTIVE"]) {
      await assert.rejects(categories.updateServiceCategoryAction(form({ categoryId: category.id, name: "Merchant category", status })), /updated%20successfully/);
      assert.equal((await prisma.serviceCategory.findUniqueOrThrow({ where: { id: category.id } })).status, status);
    }
    await assert.rejects(categories.updateServiceCategoryAction(form({ categoryId: foreignCategory.id, name: "Tampered", status: "INACTIVE" })), /not%20found/);
    await assert.rejects(categories.deleteServiceCategoryAction(form({ categoryId: foreignCategory.id })), /not%20found/);
    assert.equal((await prisma.serviceCategory.findUniqueOrThrow({ where: { id: foreignCategory.id } })).name, "Foreign category");
    context.user.role = "STAFF";
    await assert.rejects(categories.createServiceCategoryAction(form({ name: "Denied category" })), /REDIRECT/);
    await assert.rejects(categories.updateServiceCategoryAction(form({ categoryId: category.id, name: "Denied", status: "INACTIVE" })), /REDIRECT/);
    await assert.rejects(categories.deleteServiceCategoryAction(form({ categoryId: category.id })), /REDIRECT/);
    assert.equal(await prisma.serviceCategory.count({ where: { businessId: business.id } }), 1);
    context.user.role = "BUSINESS_OWNER";
    await assert.rejects(categories.createServiceCategoryAction(form({ name: "Unused category" })), /created%20successfully/);
    const unused = await prisma.serviceCategory.findFirstOrThrow({ where: { businessId: business.id, name: "Unused category" } });
    await assert.rejects(categories.deleteServiceCategoryAction(form({ categoryId: unused.id })), /deleted%20successfully/);
    assert.equal(await prisma.serviceCategory.findUnique({ where: { id: unused.id } }), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await prisma.$disconnect();
  }
});
