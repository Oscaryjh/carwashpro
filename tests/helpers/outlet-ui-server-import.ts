import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

export async function importOutletUiContext() {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") return { url: pathToFileURL(resolve("node_modules/next/dist/compiled/server-only/empty.js")).href, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  try { return await import("../../src/lib/outlet-ui-context"); }
  finally { hooks.deregister(); }
}
