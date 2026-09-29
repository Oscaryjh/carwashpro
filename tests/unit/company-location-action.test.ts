import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { hasBusinessCapability } from "../../src/lib/business-groups/business-access";

test("direct location action requires existing attendance capability, module access and trusted target", async () => {
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/location-action-"));
  const state: any = { allowed: true, writes: [], kind: "single" };
  const owner = { granted: true, source: "DIRECT_BUSINESS", identityRole: "BUSINESS_OWNER", effectiveBusinessRole: "BUSINESS_OWNER", permissions: [], businessId: "a" };
  state.access = owner;
  (globalThis as any).__locationAction = state;
  state.authorize = (capability: any) => {
    assert.equal(capability, "MODIFY_ATTENDANCE_SETTINGS");
    if (!state.allowed || state.access.source === "PLATFORM_ADMIN" || !hasBusinessCapability(state.access, capability)) throw Object.assign(new Error("denied"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    return { access: state.access, user: { userId: "owner" }, businessId: "a" };
  };
  try {
    await build({ entryPoints: ["src/app/(business)/business/settings/clock-in-location/actions.ts"], outfile: join(dir, "action.cjs"), bundle: true, platform: "node", format: "cjs", packages: "external", logLevel: "silent", plugins: [{ name: "boundaries", setup(b) {
      b.onResolve({ filter: /^(?:@\/lib\/(?:auth\/business-user|attendance\/(?:company-location|branch-setting-service)|audit)|next\/cache)$/ }, args => ({ path: args.path, namespace: "boundary" }));
      b.onLoad({ filter: /.*/, namespace: "boundary" }, args => ({ contents: args.path.endsWith("business-user") ? "export const requireBusinessUser=async c=>globalThis.__locationAction.authorize(c)" : args.path.endsWith("company-location") ? "export const resolveCompanyLocationTarget=async()=>({kind:globalThis.__locationAction.kind,branch:{id:'branch-a'},scope:{allowedBranchIds:['branch-a']}})" : args.path.endsWith("branch-setting-service") ? "export const upsertBranchAttendanceSetting=async a=>globalThis.__locationAction.writes.push(a)" : args.path.endsWith("audit") ? "export const getAuditRequestContext=async()=>({})" : "export const revalidatePath=()=>{}" }));
    } }] });
    const { saveCompanyClockInLocationAction: save } = createRequire(import.meta.url)(join(dir, "action.cjs"));
    const form = () => { const f = new FormData(); for (const [k, v] of Object.entries({ latitude: "5", longitude: "116", geofenceRadiusMeters: "100", minimumAccuracyMeters: "80", timezone: "Asia/Kuching" })) f.set(k, v); return f; };
    for (const access of [owner, { ...owner, identityRole: "STAFF", effectiveBusinessRole: "STAFF", permissions: ["ATTENDANCE_SETTINGS_MANAGE"] }]) {
      state.access = access;
      assert.equal((await save({}, form())).status, "success");
      assert.equal(state.writes.at(-1).mode, "location");
      assert.equal(state.writes.at(-1).input.branchId, "branch-a");
    }
    state.writes = [];
    for (const access of [{ ...owner, identityRole: "STAFF", permissions: [] }, { ...owner, source: "PLATFORM_ADMIN" }]) {
      state.access = access;
      await assert.rejects(save({}, form()));
    }
    state.access = owner;
    state.allowed = false;
    await assert.rejects(save({}, form()));
    state.allowed = true;
    for (const kind of ["zero", "legacy", "denied"]) { state.kind = kind; assert.equal((await save({}, form())).status, "error"); }
    state.kind = "single";
    for (const key of ["businessId", "branchId"]) { const f = form(); f.set(key, "foreign"); assert.equal((await save({}, f)).status, "error"); }
    assert.equal(state.writes.length, 0);
  } finally { delete (globalThis as any).__locationAction; await rm(dir, { recursive: true, force: true }); }
});
