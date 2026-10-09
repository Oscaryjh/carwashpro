"use client";

import { useActionState, useEffect, useState } from "react";
import { loginAction, type LoginState } from "./actions";
import { getLoginCooldown } from "./cooldown-actions";

const initialState: LoginState = {};
const cooldownKey = "tetamu-login-cooldown-email";

function rememberCooldown(email: string | null) {
  try {
    if (email) sessionStorage.setItem(cooldownKey, email);
    else sessionStorage.removeItem(cooldownKey);
  } catch { /* Storage is optional; server enforcement is not. */ }
}

export function LoginForm() {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [checking, setChecking] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  function receiveCooldown(cooldown: NonNullable<LoginState["cooldown"]>, email: string) {
    const remaining = Math.max(0, (cooldown.retryAt ?? cooldown.serverNow) - cooldown.serverNow);
    setStatusError(null);
    setExpired(remaining === 0);
    setSeconds(Math.ceil(remaining / 1000));
    setDeadline(remaining ? performance.now() + remaining : null);
    rememberCooldown(remaining ? email : null);
  }

  const [state, formAction, pending] = useActionState(async (previous: LoginState, data: FormData) => {
    const result = await loginAction(previous, data);
    setExpired(false);
    setStatusError(null);
    if (result.cooldown && result.cooldownEmail) receiveCooldown(result.cooldown, result.cooldownEmail);
    return result;
  }, initialState);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    let live = true;
    async function restore() {
      try {
        const email = sessionStorage.getItem(cooldownKey);
        if (email) {
          const cooldown = await getLoginCooldown(email);
          if (live) receiveCooldown(cooldown, email);
        }
      } catch {
        if (live) setStatusError("Could not check the remaining wait. Please try signing in again.");
      } finally {
        if (live) setChecking(false);
      }
    }
    void restore();
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
      setSeconds(remaining);
      if (!remaining) {
        setDeadline(null);
        setExpired(true);
        rememberCooldown(null);
      }
    };
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);

  const waiting = seconds > 0;
  const countdown = `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

  return (
    <form action={formAction} className="form" onSubmit={event => { if (waiting || checking || pending) event.preventDefault(); }}>
      {waiting ? <div className="error login-error">
        Too many sign-in attempts. Try again in <strong role="timer" aria-live="off">{countdown}</strong>.
      </div> : expired ? <p role="status">You can try signing in again.</p>
        : statusError || state.error ? <div className="error login-error" role="alert">{statusError ?? state.error}</div> : null}
      <label>
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        <span>Password</span>
        <div className="password-field">
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="secondary-light-button"
            type="button"
            onClick={() => setShowPassword((current) => !current)}
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </div>
      </label>
      <button type="submit" disabled={pending || waiting || checking}>
        {pending ? "Signing in..." : checking ? "Checking..." : waiting ? "Please wait" : "Sign in"}
      </button>
    </form>
  );
}
