"use client";

import { useRef, useState } from "react";
import { signOutAndNavigate } from "@/lib/auth/sign-out-client";

export function SignOutForm({ buttonClassName = "secondary-button" }: { buttonClassName?: string }) {
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  return (
    <form action="/logout" method="post" onSubmit={async (event) => {
      event.preventDefault();
      if (submitting.current) return;
      submitting.current = true;
      setPending(true);
      setError(false);
      try {
        await signOutAndNavigate(fetch, (url) => window.location.replace(url));
      } catch {
        setError(true);
        submitting.current = false;
        setPending(false);
      }
    }}>
      <button className={buttonClassName} type="submit" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error ? <p role="alert">Sign out could not be confirmed. Please try again.</p> : null}
    </form>
  );
}
