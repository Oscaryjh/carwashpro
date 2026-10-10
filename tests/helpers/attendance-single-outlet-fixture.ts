import { build } from "esbuild";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createSessionToken, persistSessionContext } from "../../src/lib/auth/session";

/** Only request/delivery boundaries are substituted. Session, capability,
 * topology, person scope and writers execute against the disposable database. */
export async function attendanceActionsFixture(database: PrismaClient) {
  const target = new URL(process.env.DATABASE_URL!);
  if (target.hostname !== "127.0.0.1" || target.port !== "55448" ||
      !target.pathname.startsWith("/tetamu_phase1d2_disposable_")) throw Error("Owned disposable database required");
  const dir = await mkdtemp(join(process.cwd(), "node_modules/.cache/attendance-actions-"));
  const state = globalThis as typeof globalThis & { attendanceDb?: PrismaClient; attendanceCookie?: string };
  state.attendanceDb = database;
  const oldSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "phase1d2-disposable-session-secret-only-20261010";
  await build({ stdin: { contents: 'export {default as AttendanceList} from "./src/app/(business)/team/attendance/page"; export {GET as AttendanceExport} from "./src/app/(business)/team/attendance/export/route"; export {saveBranchAttendanceSettingAction} from "./src/app/(business)/team/attendance-settings/actions"; export * from "./src/app/(business)/team/roster/actions"; export * from "./src/app/(business)/team/attendance/p2/actions"; export {resolveAttendanceOutletContext} from "./src/lib/attendance/outlet-server"; export {resolveBusinessAccess} from "./src/lib/business-groups/business-access";', resolveDir: process.cwd() },
    outfile: join(dir, "actions.cjs"), bundle: true, packages: "external", platform: "node", format: "cjs", jsx: "automatic", logLevel: "silent",
    plugins: [{ name: "attendance-request", setup(b) {
      b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get:(_,k)=>k})', loader: "js" }));
      b.onResolve({ filter: /^@\/lib\/prisma$|^next\/(headers|cache|navigation)$|^server-only$/ }, a => ({ path: a.path, namespace: "attendance-request" }));
      b.onLoad({ filter: /.*/, namespace: "attendance-request" }, a => ({ contents:
        a.path.endsWith("prisma") ? "export const prisma=globalThis.attendanceDb;" :
        a.path.endsWith("headers") ? "export async function cookies(){return {get(){return globalThis.attendanceCookie ? {value:globalThis.attendanceCookie}:undefined}}} export async function headers(){return new Headers()}" :
        a.path.endsWith("navigation") ? "export function redirect(url){throw Object.assign(new Error('REDIRECT'),{url,digest:'NEXT_REDIRECT;replace;'+url+';307;'})} export function notFound(){throw Object.assign(new Error('NOT_FOUND'),{digest:'NEXT_HTTP_ERROR_FALLBACK;404'})} export function unstable_rethrow(){}" :
        a.path === "server-only" ? "export {};" : "export function revalidatePath(){}" }));
    } }] });
  const actions = createRequire(import.meta.url)(join(dir, "actions.cjs")) as
    typeof import("../../src/app/(business)/team/roster/actions") &
    typeof import("../../src/app/(business)/team/attendance/p2/actions") &
    typeof import("../../src/app/(business)/team/attendance-settings/actions") &
    Pick<typeof import("../../src/lib/attendance/outlet-server"), "resolveAttendanceOutletContext"> &
    Pick<typeof import("../../src/lib/business-groups/business-access"), "resolveBusinessAccess"> &
    { AttendanceList: typeof import("../../src/app/(business)/team/attendance/page").default;
      AttendanceExport: typeof import("../../src/app/(business)/team/attendance/export/route").GET };
  return { actions, async login(userId: string, activeBusinessId?: string) {
    const user = await database.user.findUniqueOrThrow({ where: { id: userId } });
    const session = { userId, sessionId: randomUUID(), homeBusinessId: user.businessId, activeBusinessId: activeBusinessId ?? user.businessId,
      contextVersion: 1, branchId: user.branchId, name: user.name, email: user.email!, role: user.role,
      permissions: user.permissions, status: user.status };
    const stored = await persistSessionContext(session, { database });
    state.attendanceCookie = await createSessionToken(session, { absoluteExpiresAt: stored.absoluteExpiresAt });
  }, async close() {
    delete state.attendanceDb; delete state.attendanceCookie;
    if (oldSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = oldSecret;
    await rm(dir, { recursive: true, force: true });
  } };
}
