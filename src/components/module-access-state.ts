import { MODULE_REGISTRY, moduleDependents, moduleKeys, type ModuleKey } from "@/lib/modules/registry";

export type ModuleAccessRow = {
  key: ModuleKey;
  status: "ENABLED" | "DISABLED";
  from: string;
  until: string | null;
  plan: string;
  revision: number | null;
  source: string | null;
};

export function changedModules(baseline: ModuleAccessRow[], draft: ModuleAccessRow[]) {
  return draft.filter((row) => {
    if (row.key === "CORE") return false;
    const before = baseline.find((item) => item.key === row.key);
    return !before || row.status !== before.status || row.from !== before.from || row.until !== before.until || row.plan !== before.plan;
  });
}

export function shouldPreserveModuleDraft(baseline: ModuleAccessRow[], draft: ModuleAccessRow[], hasSubmittedDraft: boolean) {
  return !hasSubmittedDraft && changedModules(baseline, draft).length > 0;
}

export function coversModuleWindow(parent: ModuleAccessRow, child: ModuleAccessRow) {
  return parent.status === "ENABLED" && Date.parse(parent.from) <= Date.parse(child.from) &&
    (parent.until === null || (child.until !== null && Date.parse(parent.until) >= Date.parse(child.until)));
}

// UI preview only. The existing service remains the authority at save time.
export function proposeModuleEdit(rows: ModuleAccessRow[], edited: ModuleAccessRow, now = Date.now()): {
  rows: ModuleAccessRow[]; dependencies: ModuleKey[]; error: string | null;
} {
  const projected = rows.map((row) => row.key === edited.key ? { ...edited } : { ...row });
  const dependencies: ModuleKey[] = [];
  const result = (error: string | null = null) => ({ rows: projected, dependencies, error });
  if (edited.key === "CORE") return result("Core platform is required and cannot be edited.");
  if (!Number.isFinite(Date.parse(edited.from)) || (edited.until !== null &&
    (!Number.isFinite(Date.parse(edited.until)) || Date.parse(edited.until) <= Date.parse(edited.from)))) {
    return result("Expiry must be after the start date, and both dates must be valid.");
  }
  if (edited.status === "DISABLED") {
    const enabledDependents = moduleDependents(edited.key).filter((key) => {
      const row = projected.find((item) => item.key === key);
      return row?.status === "ENABLED" && (row.until === null || Date.parse(row.until) > now);
    });
    if (enabledDependents.length) return result(`Disable ${enabledDependents.map((key) => MODULE_REGISTRY[key].label).join(", ")} before disabling ${MODULE_REGISTRY[edited.key].label}.`);
    return result();
  }
  function coverDependencies(child: ModuleAccessRow) {
    for (const key of MODULE_REGISTRY[child.key].dependencies) {
      if (key === "CORE") continue;
      const parent = projected.find((item) => item.key === key)!;
      if (!coversModuleWindow(parent, child)) {
        const wasEnabled = parent.status === "ENABLED";
        parent.from = wasEnabled && Date.parse(parent.from) < Date.parse(child.from) ? parent.from : child.from;
        parent.until = !wasEnabled ? child.until : parent.until === null || child.until === null ? null :
          Date.parse(parent.until) > Date.parse(child.until) ? parent.until : child.until;
        parent.status = "ENABLED";
        if (!dependencies.includes(key)) dependencies.push(key);
      }
      coverDependencies(parent);
    }
  }
  coverDependencies(edited);
  return result();
}

export function moduleAccessCounts(rows: ModuleAccessRow[]) {
  const enabled = rows.filter((row) => row.key === "CORE" || row.status === "ENABLED").length;
  return { enabled, disabled: rows.length - enabled, total: rows.length };
}

export function effectiveModuleKeys(rows: ModuleAccessRow[], now: number) {
  const enabled = new Set<ModuleKey>(["CORE"]);
  for (let pass = 0; pass < moduleKeys.length; pass++) {
    for (const row of rows) {
      if (row.status === "ENABLED" && Date.parse(row.from) <= now && (row.until === null || Date.parse(row.until) > now) &&
        MODULE_REGISTRY[row.key].dependencies.every((key) => enabled.has(key))) enabled.add(row.key);
    }
  }
  return enabled;
}
