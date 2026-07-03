import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const extensions = [".ts", ".tsx", ".js", ".mjs"];

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const resolved = resolveLocalTypeScriptSpecifier(specifier, context);

    if (resolved) {
      return resolved;
    }

    throw error;
  }
}

function resolveLocalTypeScriptSpecifier(specifier, context) {
  if (specifier.startsWith("@/")) {
    return resolveCandidatePath(join(process.cwd(), "src", specifier.slice(2)));
  }

  if (
    (specifier.startsWith(".") || specifier.startsWith("/")) &&
    context.parentURL
  ) {
    const baseUrl = new URL(specifier, context.parentURL);
    return resolveCandidateUrl(baseUrl);
  }

  return null;
}

function resolveCandidateUrl(baseUrl) {
  for (const extension of extensions) {
    const candidate = new URL(`${baseUrl.href}${extension}`);
    const filePath = fileURLToPath(candidate);

    if (existsSync(filePath)) {
      return {
        shortCircuit: true,
        url: candidate.href,
      };
    }
  }

  return null;
}

function resolveCandidatePath(basePath) {
  for (const extension of extensions) {
    const candidate = `${basePath}${extension}`;

    if (existsSync(candidate)) {
      return {
        shortCircuit: true,
        url: pathToFileURL(candidate).href,
      };
    }
  }

  return null;
}
