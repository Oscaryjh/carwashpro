import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createSessionToken, persistSessionContext } from "../../src/lib/auth/session";

/** Only request/delivery boundaries are substituted. Session, capability,
 * topology, person scope and writers execute against the disposable database. */
export async function peopleActionsFixture(database: PrismaClient) {
  const target = new URL(process.env.DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "55447" ||
      !target.pathname.startsWith("/tetamu_phase1d1_disposable_")) throw Error("Owned disposable database required");
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/people-actions-"));
  const state = globalThis as typeof globalThis & { peopleDb?: PrismaClient; peopleCookie?: string };
  state.peopleDb = database;
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "people-disposable-session-secret-only-0123456789";
  await build({ stdin: { contents: 'export * from "./src/app/(business)/team/employees/actions"; export {createStaffAction,updateStaffAction} from "./src/app/(business)/team/actions"; export {resolveBusinessOutletTopology} from "./src/lib/outlet-context"; export {readPeopleWorkplaceProfile} from "./src/lib/team/people-outlet-server";', resolveDir: process.cwd() },
    outfile: join(dir, "actions.cjs"), bundle: true, packages: "external", platform: "node", format: "cjs", logLevel: "silent",
    plugins: [{ name: "people-request", setup(b) {
      b.onResolve({ filter: /^@\/lib\/prisma$|^next\/(headers|cache|navigation)$|^server-only$/ }, a => ({ path: a.path, namespace: "people-request" }));
      b.onLoad({ filter: /.*/, namespace: "people-request" }, a => ({ contents:
        a.path.endsWith("prisma") ? "export const prisma=globalThis.peopleDb;" :
        a.path.endsWith("headers") ? "export async function cookies(){return {get(){return globalThis.peopleCookie ? {value:globalThis.peopleCookie}:undefined}}} export async function headers(){return new Headers()}" :
        a.path.endsWith("navigation") ? "export function redirect(url){throw Object.assign(new Error('REDIRECT'),{url,digest:'NEXT_REDIRECT;replace;'+url+';307;'})} export function unstable_rethrow(){}" :
        a.path === "server-only" ? "export {};" : "export function revalidatePath(){}" }));
    } }] });
  const actions = createRequire(import.meta.url)(join(dir, "actions.cjs")) as
    typeof import("../../src/app/(business)/team/employees/actions") &
    Pick<typeof import("../../src/app/(business)/team/actions"), "createStaffAction" | "updateStaffAction"> &
    Pick<typeof import("../../src/lib/outlet-context"), "resolveBusinessOutletTopology"> &
    Pick<typeof import("../../src/lib/team/people-outlet-server"), "readPeopleWorkplaceProfile">;
  return { actions, async login(userId: string, activeBusinessId?: string) {
    const user = await database.user.findUniqueOrThrow({ where: { id: userId } });
    const session = { userId, sessionId: randomUUID(), homeBusinessId: user.businessId, activeBusinessId: activeBusinessId ?? user.businessId,
      contextVersion: 1, branchId: user.branchId, name: user.name, email: user.email!, role: user.role,
      permissions: user.permissions, status: user.status };
    const stored = await persistSessionContext(session, { database });
    state.peopleCookie = await createSessionToken(session, { absoluteExpiresAt: stored.absoluteExpiresAt });
  }, async close() {
    delete state.peopleDb; delete state.peopleCookie;
    if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
    await rm(dir, { recursive: true, force: true });
  } };
}
