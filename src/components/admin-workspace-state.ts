export const workspaceSections = ["overview", "modules", "profile", "branches", "users"] as const;
export type WorkspaceSection = typeof workspaceSections[number];

export function workspaceSection(value: string | null): WorkspaceSection {
  return workspaceSections.includes(value as WorkspaceSection) ? value as WorkspaceSection : "overview";
}
export function rememberedWorkspaceSection(current: string | null, saved: string | null): WorkspaceSection {
  return workspaceSection(current ?? saved);
}
export async function submitWorkspaceBranchChange(action: (data: FormData) => Promise<void>, data: FormData) {
  try { await action(data); return { ok: true } as const; }
  catch { return { ok: false, message: "Unable to update this branch. Please try again." } as const; }
}
export function workspaceHref(pathname: string, query: string, section: WorkspaceSection) {
  const params = new URLSearchParams(query);
  params.delete("type"); params.delete("message"); params.set("section", section);
  return `${pathname}?${params.toString()}`;
}
export function matchesWorkspaceSearch(query: string, fields: (string | null)[]) {
  const search = query.trim().toLocaleLowerCase();
  return !search || fields.some((value) => value?.toLocaleLowerCase().includes(search));
}
export function passwordConfirmationError(password: string, confirmation: string) {
  return password === confirmation ? "" : "Passwords do not match.";
}
