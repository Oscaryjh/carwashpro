import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>WashFlow</h1>
        <p>Sign in to manage your car wash business workspace.</p>
        <LoginForm />
      </section>
    </main>
  );
}
