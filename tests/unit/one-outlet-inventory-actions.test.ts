import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

test("inventory actions resolve missing single-store input on the server and deny invalid scope", async () => {
  const cache = join(process.cwd(), "node_modules", ".cache");
  await mkdir(cache, { recursive: true });
  const directory = await mkdtemp(join(cache, "outlet-inventory-test-"));
  const id = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const state = { branches: [{ id, name: "Store" }], calls: [] as any[] };
  const key = "__oneOutletInventoryActionTest";
  (globalThis as any)[key] = state;
  try {
    for (const entry of ["actions", "stock-count-actions"]) {
      const outfile = join(directory, `${entry}.cjs`);
      await build({ entryPoints: [`src/app/(business)/inventory/${entry}.ts`], outfile, bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent",
        plugins: [{ name: "test-boundaries", setup(builder) {
          builder.onResolve({ filter: /^(?:@\/lib\/(?:auth\/business-user|prisma|inventory\/(?:service|stock-count-service))|next\/(?:cache|navigation))$/ }, args => ({ path: args.path, namespace: "test-boundary" }));
          builder.onLoad({ filter: /.*/, namespace: "test-boundary" }, args => {
            const stateRef = `globalThis[${JSON.stringify(key)}]`;
            const contents = args.path.endsWith("auth/business-user") ? `export async function requireBusinessUserForModule(){return {businessId:'business-a',user:{userId:'owner',role:'BUSINESS_OWNER'}}}` :
              args.path.endsWith("/prisma") ? `export const prisma={branch:{findMany:async ({where})=>{if(where.businessId!=='business-a'||where.status!=='ACTIVE')throw Error('wrong scope');return ${stateRef}.branches}}}` :
              args.path === "next/cache" ? "export function revalidatePath(){}" :
              args.path === "next/navigation" ? "export function redirect(url){throw Error('REDIRECT:'+url)}" :
              `const call=async input=>{${stateRef}.calls.push(input);return {id:'count'}}; export const runManualInventoryMovement=call,transferInventory=call,createStockCount=call,approveStockCount=call,cancelStockCount=call,recordStockCountLine=call,reopenStockCount=call,setReorderSettings=call,startStockCount=call,submitStockCount=call;export const mapStockCountError=e=>e.message;`;
            return { contents };
          });
        } }],
      });
      const actions = createRequire(import.meta.url)(outfile);
      const action = entry === "actions" ? actions.stockInAction : actions.createStockCountAction;
      const form = () => { const data = new FormData(); for (const [k,v] of Object.entries({ operationKey: "synthetic-operation-key", productId: id, quantity: "1", reason: "Synthetic test", countType: "FULL_BRANCH_COUNT" })) data.set(k,v); return data; };
      for (const supplied of [undefined, ""]) {
        state.branches = [{ id, name: "Store" }]; state.calls = [];
        const data = form(); if (supplied !== undefined) data.set("branchId", supplied);
        await assert.rejects(action(data), /type=success/);
        assert.equal(state.calls.length, 1); assert.equal(state.calls[0].branchId, id);
      }
      for (const branches of [[], [{ id, name: "Store" }, { id: other, name: "Legacy" }]]) {
        state.branches = branches; state.calls = [];
        await assert.rejects(action(form()), /type=error/);
        assert.equal(state.calls.length, 0);
      }
      state.branches = [{ id, name: "Store" }]; state.calls = [];
      const foreign = form(); foreign.set("branchId", other);
      await assert.rejects(action(foreign), /type=error/);
      assert.equal(state.calls.length, 0);
    }
  } finally { delete (globalThis as any)[key]; await rm(directory, { recursive: true, force: true }); }
});
