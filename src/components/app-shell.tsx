import Link from "next/link";
import type { ReactNode } from "react";
import type { AppSession } from "@/lib/auth/session";

type AppShellProps = {
  user: AppSession;
  children: ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          WashFlow
        </Link>
        <nav>
          <Link href="/dashboard">Dashboard</Link>
          {user.role === "PLATFORM_ADMIN" ? (
            <Link href="/admin/businesses">Businesses</Link>
          ) : null}
          {["BUSINESS_OWNER", "STAFF"].includes(user.role) ? (
            <Link href="/crm">CRM</Link>
          ) : null}
          {["BUSINESS_OWNER", "STAFF"].includes(user.role) ? (
            <Link href="/services">Services</Link>
          ) : null}
          {["BUSINESS_OWNER", "STAFF"].includes(user.role) ? (
            <Link href="/packages">Packages</Link>
          ) : null}
          {["BUSINESS_OWNER", "STAFF"].includes(user.role) ? (
            <Link href="/work-orders">Work Orders</Link>
          ) : null}
          {["BUSINESS_OWNER", "STAFF"].includes(user.role) ? (
            <Link href="/pos">POS</Link>
          ) : null}
          {["BUSINESS_OWNER", "STAFF"].includes(user.role) ? (
            <Link href="/invoices">Invoices</Link>
          ) : null}
          {["BUSINESS_OWNER", "STAFF"].includes(user.role) ? (
            <Link href="/whatsapp">WhatsApp</Link>
          ) : null}
          {user.role === "BUSINESS_OWNER" ? (
            <Link href="/business/settings">Business settings</Link>
          ) : null}
        </nav>
        <form action="/logout" method="post">
          <button className="secondary-button" type="submit">
            Sign out
          </button>
        </form>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            <strong>{user.name}</strong>
            <span>{formatRole(user.role)}</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}

function formatRole(role: AppSession["role"]) {
  return role.toLowerCase().replace("_", " ");
}
