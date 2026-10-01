/** Navigate only after the server has acknowledged session revocation. */
export async function signOutAndNavigate(
  request: typeof fetch,
  replace: (url: string) => void,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await request("/logout", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok || (await response.json()).ok !== true) {
      throw new Error("Sign out was not confirmed.");
    }
    replace("/login");
  } finally {
    clearTimeout(timeout);
  }
}
