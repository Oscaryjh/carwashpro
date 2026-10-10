import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const state = { count: 1, role: "BUSINESS_OWNER", revoked: false };
const globals = globalThis as typeof globalThis & { __expenseScope?: typeof state };
let directory: string;
let resolve: (input: Record<string, unknown>) => Promise<string | null>;
before(async () => {
  globals.__expenseScope = state;
  directory = await mkdtemp(join(tmpdir(), "tetamu-expense-scope-"));
  const stubs: Record<string, string> = {
    "server-only": "",
    "@/lib/business-groups/business-access": `export async function resolveBusinessAccess(){const s=globalThis.__expenseScope;return s.revoked?{granted:false}:{granted:true,businessId:'business',userId:'actor',source:'DIRECT_BUSINESS',industryType:'SALON_BEAUTY',effectiveBusinessRole:s.role,branchId:s.role==='STAFF'?'branch-a':null,permissions:[]}}`,
    "@/lib/modules/entitlements": `export class ModuleNotEnabledError extends Error{};export async function requireBusinessModules(){}`,
    "@/lib/prisma": `export const prisma={branch:{findMany:async()=>Array.from({length:globalThis.__expenseScope.count},(_,i)=>({id:i?'branch-b':'branch-a',name:'Outlet'})),findFirst:async({where})=>where.id==='branch-a'?{id:'branch-a'}:null}}`,
  };
  await build({ entryPoints: ["src/lib/expense/create-branch.ts"], outfile: join(directory, "scope.cjs"), bundle: true, platform: "node", packages: "external", format: "cjs", plugins: [{ name: "scope-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, a => Object.hasOwn(stubs, a.path) ? { path: a.path, namespace: "stub" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "stub" }, a => ({ contents: stubs[a.path], resolveDir: process.cwd() }));
  } }] });
  resolve = require(join(directory, "scope.cjs")).resolveExpenseCreateBranch;
});
after(async () => { delete globals.__expenseScope; if (directory) await rm(directory, { recursive: true, force: true }); });
function input(expenseScope: string, branchId?: string) {
  return { businessId: "business", access: { granted: true, effectiveBusinessRole: state.role }, user: { userId: "actor", role: state.role, branchId: state.role === "STAFF" ? "branch-a" : null }, expenseScope, ...(branchId === undefined ? {} : { requestedBranchId: branchId }) };
}
test("single Owner can explicitly create Business-wide without implicit outlet conversion", async () => {
  state.count = 1; state.role = "BUSINESS_OWNER"; state.revoked = false;
  assert.equal(await resolve(input("BUSINESS_WIDE")), null);
});
test("Staff cannot turn a presentation intent into Business-wide authority", async () => {
  state.role = "STAFF";
  await assert.rejects(resolve(input("BUSINESS_WIDE")));
  state.role = "BUSINESS_OWNER";
});
test("Business-wide intent plus an explicit branch is rejected rather than guessed", async () => {
  await assert.rejects(resolve(input("BUSINESS_WIDE", "branch-a")));
});
test("This outlet resolves fresh, rejects stale multi topology and foreign explicit input", async () => {
  assert.equal(await resolve(input("THIS_OUTLET")), "branch-a");
  await assert.rejects(resolve(input("THIS_OUTLET", "foreign")));
  state.count = 2;
  await assert.rejects(resolve(input("THIS_OUTLET")));
  state.count = 1;
});
test("zero-location separates authorized Business-wide from impossible outlet write", async () => {
  state.count = 0;
  assert.equal(await resolve(input("BUSINESS_WIDE")), null);
  await assert.rejects(resolve(input("THIS_OUTLET")));
  state.count = 1;
});
test("permission revocation rejects even a previously rendered Owner intent", async () => {
  state.revoked = true;
  await assert.rejects(resolve(input("BUSINESS_WIDE")));
  state.revoked = false;
});
