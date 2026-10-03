import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createSessionToken, persistSessionContext } from "../../src/lib/auth/session";

export async function createClosingActionsFixture(database: PrismaClient) {
  if (!/disposable/.test(new URL(process.env.DATABASE_URL!).pathname)) throw Error("Disposable database required");
  const directory = await mkdtemp(join(process.cwd(), "node_modules/.cache/closing-actions-"));
  const state = globalThis as typeof globalThis & { closingDb?: PrismaClient; closingCookie?: string };
  state.closingDb = database;
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "closing-disposable-authenticated-secret-0123456789";
  await build({ stdin: { contents: 'export * from "./src/app/(business)/closing/actions"; export {saveClosingWhatsAppAutomationSettingsAction} from "./src/app/(business)/whatsapp/settings/actions";', resolveDir: process.cwd() }, outfile: join(directory, "actions.cjs"), bundle: true, packages: "external", platform: "node", format: "cjs", plugins: [{ name: "closing-request", setup(b) {
    b.onResolve({ filter: /^@\/lib\/prisma$|^next\/(headers|cache|navigation)$/ }, a => ({ path: a.path, namespace: "closing-request" }));
    b.onLoad({ filter: /.*/, namespace: "closing-request" }, a => ({ contents: a.path.endsWith("prisma") ? "export const prisma=globalThis.closingDb;" : a.path.endsWith("headers") ? "export async function cookies(){return {get(){return globalThis.closingCookie ? {value:globalThis.closingCookie}:undefined}}} export async function headers(){return new Headers()}" : a.path.endsWith("navigation") ? "export function redirect(url){throw Object.assign(new Error('REDIRECT'),{url})} export function unstable_rethrow(){}" : "export function revalidatePath(){}" }));
  } }] });
  const actions = createRequire(import.meta.url)(join(directory, "actions.cjs")) as typeof import("../../src/app/(business)/closing/actions") & Pick<typeof import("../../src/app/(business)/whatsapp/settings/actions"), "saveClosingWhatsAppAutomationSettingsAction">;
  return { actions, async login(userId: string) {
    const user = await database.user.findUniqueOrThrow({ where: { id: userId } });
    const session = { userId, sessionId: randomUUID(), homeBusinessId: user.businessId, activeBusinessId: user.businessId, contextVersion: 1, branchId: user.branchId, name: user.name, email: user.email!, role: user.role, permissions: user.permissions, status: user.status };
    const stored = await persistSessionContext(session, { database });
    state.closingCookie = await createSessionToken(session, { absoluteExpiresAt: stored.absoluteExpiresAt });
  }, async close() { delete state.closingDb; delete state.closingCookie; if(oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret; await rm(directory, {recursive:true,force:true}); } };
}

export function closingForm(values: Record<string,string>) { const f=new FormData(); for(const [k,v] of Object.entries({notes:"",closingNote:"",returnTo:"",...values})) f.set(k,v); return f; }
export async function actionRedirect(call: Promise<unknown>) { try { await call; throw Error("Expected redirect"); } catch(e) { if(typeof (e as {url?:unknown}).url !== "string") throw e; return (e as {url:string}).url; } }
