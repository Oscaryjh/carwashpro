import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function importAttendanceOutletServer() {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: pathToFileURL(resolve("node_modules/next/dist/compiled/server-only/empty.js")).href, shortCircuit: true };
    return nextResolve(specifier, context);
  } });
  try { return { server: await import("../../src/lib/attendance/outlet-server"), company: await import("../../src/lib/attendance/company-location") }; }
  finally { hooks.deregister(); }
}
