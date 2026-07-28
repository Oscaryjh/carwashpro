import Link from "next/link";
import { getSession } from "@/lib/auth/session";

export default async function NoBusinessAccessPage() {
  const session = await getSession();

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>No business access</h1>
        <p>
          This account does not currently have access to an active business.
          Contact your platform administrator if access should be restored.
        </p>
        <div className="form-actions">
          <Link className="button-link" href={session ? "/logout" : "/login"}>
            {session ? "Sign out" : "Return to login"}
          </Link>
        </div>
      </section>
    </main>
  );
}
