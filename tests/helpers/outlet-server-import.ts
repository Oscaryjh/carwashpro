import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

// Next handles this marker at build time. Node tests supply only its server target.
export async function importOutletContext() {
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "server-only") {
        return { url: pathToFileURL(resolve("node_modules/next/dist/compiled/server-only/empty.js")).href, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    return await import("../../src/lib/outlet-context");
  } finally {
    hooks.deregister();
  }
}
