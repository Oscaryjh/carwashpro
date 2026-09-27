"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AdminResetPasswordForm } from "./admin-reset-password-form";
import { AdminUpdateLoginEmailForm } from "./admin-update-login-email-form";
import { matchesWorkspaceSearch, workspaceHref, workspaceSection, workspaceSections, rememberedWorkspaceSection, submitWorkspaceBranchChange, type WorkspaceSection } from "./admin-workspace-state";
import styles from "./admin-business-workspace.module.css";

type Branch = { id: string; name: string; phone: string | null; address: string | null; status: string };
type User = { id: string; name: string; email: string | null; role: string; status: string };
type Props = {
  business: { id: string; name: string; slug: string; industry: string; companyNo: string | null; status: string };
  branches: Branch[]; users: User[]; enabledModules: number;
  modules: ReactNode; profile: ReactNode;
  branchStatusAction: (data: FormData) => Promise<void>;
  result: { type?: string; message?: string };
};
const labels: Record<WorkspaceSection, string> = { overview: "Overview", modules: "Modules & access", profile: "Company profile", branches: "Branches", users: "Users" };
const readable = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());

export function AdminBusinessWorkspace({ business, branches, users, enabledModules, modules, profile, branchStatusAction, result }: Props) {
  const pathname = usePathname() ?? `/admin/businesses/${business.id}`;
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams?.toString() ?? "");
  const section = workspaceSection(params.get("section"));
  const [branchSearch, setBranchSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [copyError, setCopyError] = useState("");
  const [profileVersion, setProfileVersion] = useState(0);
  const [editing, setEditing] = useState<{ user: User; mode: "email" | "password" } | null>(null);
  const [branchDialog, setBranchDialog] = useState<{ branch: Branch; confirm: boolean } | null>(null);
  const [branchError, setBranchError] = useState("");
  const [branchSaving, setBranchSaving] = useState(false);
  const storageKey = `tetamu:workspace-section:${business.id}`;

  function select(next: WorkspaceSection) {
    window.history.pushState(null, "", workspaceHref(pathname, params.toString(), next));
    try { sessionStorage.setItem(storageKey, next); } catch { /* URL remains authoritative. */ }
  }
  useEffect(() => {
    // Existing actions redirect to the detail URL. Restore its section without changing their contracts.
    try {
      const current = searchParams?.get("section") ?? null;
      const saved = sessionStorage.getItem(storageKey);
      const selected = rememberedWorkspaceSection(current, saved);
      if (current !== null) sessionStorage.setItem(storageKey, selected);
      else if (saved) {
        const restored = new URLSearchParams(searchParams?.toString() ?? "");
        restored.set("section", selected);
        window.history.replaceState(null, "", `${pathname}?${restored}`);
      }
    } catch { /* Optional navigation memory only. */ }
  }, [searchParams, pathname, storageKey]);
  useEffect(() => { setBranchError(""); }, [branchDialog]);
  useEffect(() => {
    if (result.type === "success" && result.message) setNotice(result.message.includes("entitlement") ? "Module access updated" : result.message);
  }, [result.type, result.message]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5000); return () => clearTimeout(timer); }, [notice]);

  const visibleBranches = branches.filter((branch) => matchesWorkspaceSearch(branchSearch, [branch.name, branch.phone, branch.address, readable(branch.status)]));
  const visibleUsers = users.filter((user) => matchesWorkspaceSearch(userSearch, [user.name, user.email, readable(user.role), readable(user.status)]));

  return <div className={styles.workspace}>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/admin/businesses">Businesses</Link><span aria-hidden="true">/</span><span>{business.name}</span></nav>
    <header className={styles.header}>
      <div><h1>{business.name}</h1><p>{business.industry}<span aria-hidden="true"> · </span>{business.slug}</p></div>
      <div className={styles.headerActions}><Status value={business.status} /><button type="button" className={styles.secondary} onClick={() => select("profile")}>Edit company</button></div>
    </header>
    <section className={styles.metrics} aria-label="Business summary">
      {[['Branches', branches.length], ['Users', users.length], ['Enabled modules', enabledModules]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
    </section>
    {notice && <div className={styles.toast} role="status"><span aria-hidden="true">✓ </span>{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    {result.type === "error" && result.message && <p className={styles.error} role="alert">{result.message}</p>}
    <div className={styles.layout}>
      <nav className={styles.navigation} aria-label="Business workspace sections">{workspaceSections.map((key) => <a key={key} href={workspaceHref(pathname, params.toString(), key)} aria-current={section === key ? "page" : undefined} onClick={(event) => { if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); select(key); } }}><span>{labels[key]}</span>{key === "branches" ? <small>{branches.length}</small> : key === "users" ? <small>{users.length}</small> : null}</a>)}</nav>
      <div className={styles.content}>
        <section hidden={section !== "overview"} className={styles.panel} aria-label="Overview">
          <div className={styles.panelHeading}><div><h2>Business information</h2><p>Company identity and workspace status.</p></div><button className={styles.secondary} onClick={() => select("profile")}>Edit company</button></div>
          <dl className={styles.info}>{[["Company name", business.name], ["Industry", business.industry], ["Company no.", business.companyNo || "Not set"], ["Slug", business.slug], ["Status", readable(business.status)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          <details className={styles.advanced}><summary>Advanced / Developer information</summary><p>Company ID</p><div><code>{business.id}</code><button className={styles.secondary} onClick={async () => { try { await navigator.clipboard.writeText(business.id); setCopyError(""); setNotice("Company ID copied"); } catch { setCopyError("Unable to copy. Select the company ID and copy it manually."); } }}>Copy</button></div>{copyError && <p role="alert">{copyError}</p>}</details>
        </section>
        <section hidden={section !== "modules"} aria-label="Modules & access">{modules}</section>
        <section hidden={section !== "profile"} className={`${styles.panel} ${styles.profile}`} aria-label="Company profile">
          <div className={styles.panelHeading}><div><h2>Company profile</h2><p>Update company information. Industry and slug are read-only.</p></div></div>
          <div onClick={(event) => { if (event.target instanceof Element && event.target.closest('button[data-workspace-discard]')) { event.preventDefault(); setProfileVersion((value) => value + 1); setNotice("Unsaved company changes discarded"); } }}><Fragment key={profileVersion}>{profile}</Fragment></div>
        </section>
        <section hidden={section !== "branches"} className={styles.panel} aria-label="Branches">
          <div className={styles.panelHeading}><div><h2>Branches <small>{branches.length}</small></h2><p>Locations operating under this business.</p></div><Link className={styles.primary} href={`/admin/businesses/${business.id}/branches/new`}>+ Add branch</Link></div>
          <Search label="Search branches" value={branchSearch} onChange={setBranchSearch} />
          <div className={styles.tableWrap}><table><thead><tr>{["Name", "Phone", "Address", "Status", "Action"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{visibleBranches.map((branch) => <tr key={branch.id}><th scope="row">{branch.name}</th><td>{branch.phone || "—"}</td><td className={styles.address}>{branch.address || "—"}</td><td><Status value={branch.status} /></td><td><RowActions label={branch.name}><button onClick={() => setBranchDialog({ branch, confirm: false })}>View details</button><button onClick={() => setBranchDialog({ branch, confirm: true })}>{branch.status === "ACTIVE" ? "Deactivate" : "Activate"}</button></RowActions></td></tr>)}{!visibleBranches.length && <tr><td colSpan={5} className={styles.empty}>{branches.length ? "No branches match your search." : "No branches yet. Add your first location."}</td></tr>}</tbody></table></div>
        </section>
        <section hidden={section !== "users"} className={styles.panel} aria-label="Users">
          <div className={styles.panelHeading}><div><h2>Users <small>{users.length}</small></h2><p>Manage existing login email and password. Names, roles and status are read-only here.</p></div></div>
          <Search label="Search users" value={userSearch} onChange={setUserSearch} />
          <div className={styles.tableWrap}><table><thead><tr>{["Name", "Login email", "Role", "Status", "Action"].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{visibleUsers.map((user) => <tr key={user.id}><th scope="row">{user.name}</th><td>{user.email || "No login email"}</td><td>{readable(user.role)}</td><td><Status value={user.status} /></td><td>{["BUSINESS_OWNER", "STAFF"].includes(user.role) ? <RowActions label={user.name}><button onClick={() => setEditing({ user, mode: "email" })}>Edit user</button><button onClick={() => setEditing({ user, mode: "password" })}>Reset password</button></RowActions> : <span className={styles.muted}>Read-only</span>}</td></tr>)}{!visibleUsers.length && <tr><td colSpan={5} className={styles.empty}>{users.length ? "No users match your search." : "No users are assigned to this business."}</td></tr>}</tbody></table></div>
        </section>
      </div>
    </div>
    {editing && <WorkspaceDialog title={editing.mode === "email" ? "Edit user" : "Reset password"} close={() => setEditing(null)}>
      <p className={styles.muted}>{editing.user.name}</p>
      {editing.mode === "email" ? <><dl className={styles.drawerInfo}><div><dt>Name</dt><dd>{editing.user.name}</dd></div><div><dt>Role</dt><dd>{readable(editing.user.role)}</dd></div><div><dt>Status</dt><dd>{readable(editing.user.status)}</dd></div></dl><AdminUpdateLoginEmailForm businessId={business.id} userId={editing.user.id} email={editing.user.email} onCancel={() => setEditing(null)} onSuccess={(message) => { setEditing(null); setNotice(message); }} /></> : <AdminResetPasswordForm businessId={business.id} userId={editing.user.id} userEmail={editing.user.email} onCancel={() => setEditing(null)} onSuccess={(message) => { setEditing(null); setNotice(message); }} />}
    </WorkspaceDialog>}
    {branchDialog && <WorkspaceDialog title={branchDialog.confirm ? `${branchDialog.branch.status === "ACTIVE" ? "Deactivate" : "Activate"} branch?` : "Branch details"} close={() => { if (!branchSaving) setBranchDialog(null); }}>
      <dl className={styles.drawerInfo}>{[["Name", branchDialog.branch.name], ["Phone", branchDialog.branch.phone || "—"], ["Address", branchDialog.branch.address || "—"], ["Status", readable(branchDialog.branch.status)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {branchDialog.confirm ? <form action={async (data) => { setBranchSaving(true); setBranchError(""); const outcome = await submitWorkspaceBranchChange(branchStatusAction, data); setBranchSaving(false); if (outcome.ok) { setBranchDialog(null); setNotice("Branch status updated"); } else setBranchError(outcome.message); }}><p>{branchDialog.branch.status === "ACTIVE" ? "This location will become inactive. Existing records are retained." : "This location will become active."}</p><input type="hidden" name="businessId" value={business.id} /><input type="hidden" name="branchId" value={branchDialog.branch.id} /><input type="hidden" name="status" value={branchDialog.branch.status === "ACTIVE" ? "INACTIVE" : "ACTIVE"} />{branchError && <p role="alert" className={styles.error}>{branchError}</p>}<BranchConfirm inactive={branchDialog.branch.status === "ACTIVE"} cancel={() => setBranchDialog(null)} /></form> : <button className={styles.secondary} onClick={() => setBranchDialog(null)}>Close</button>}
    </WorkspaceDialog>}
  </div>;
}

function Status({ value }: { value: string }) { return <span className={value.toLowerCase() === "active" ? styles.active : styles.inactive}>{readable(value)}</span>; }
function Search({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className={styles.search}><span className="sr-only">{label}</span><input type="search" placeholder={`${label}…`} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function RowActions({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return <details ref={ref} className={styles.rowActions} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary aria-label={`Actions for ${label}`}>⋯</summary><div onClick={() => { if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } }}>{children}</div></details>;
}
function WorkspaceDialog({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => { dialog?.close(); requestAnimationFrame(() => { if (trigger?.isConnected) trigger.focus(); }); };
  }, []);
  return <dialog ref={ref} className={styles.drawer} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close(); }} onClick={(event) => { if (event.target === event.currentTarget) close(); }}><header><h2 id={titleId}>{title}</h2><button type="button" className={styles.secondary} aria-label="Close dialog" onClick={close}>×</button></header><div className={styles.drawerBody}>{children}</div></dialog>;
}
function BranchConfirm({ inactive, cancel }: { inactive: boolean; cancel: () => void }) { const { pending } = useFormStatus(); return <footer className={styles.dialogFooter}><button type="button" className={styles.secondary} onClick={cancel} disabled={pending}>Cancel</button><button type="submit" className={inactive ? styles.danger : styles.primary} disabled={pending}>{pending ? "Saving…" : inactive ? "Deactivate branch" : "Activate branch"}</button></footer>; }
