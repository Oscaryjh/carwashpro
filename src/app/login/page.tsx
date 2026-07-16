import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message =
    params.error === "business-not-found"
      ? "Business not found, please login again"
      : null;

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <h1>TETAMU POS</h1>
        <p>Sign in to manage your business workspace.</p>
        {message ? <p className="status failed">{message}</p> : null}
        <LoginForm />
      </section>
    </main>
  );
}
