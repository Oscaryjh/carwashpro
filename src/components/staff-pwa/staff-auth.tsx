"use client";

import { useRouter } from "next/navigation";
import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clearEmployeeAuthFlow,
  getDeviceMetadata,
  getOrCreateDeviceIdentifier,
  maskPhoneForDisplay,
  readEmployeeAuthFlow,
  saveEmployeeAuthFlow,
  StaffApiError,
  staffApiFetch,
} from "@/lib/staff-pwa/client";
import type {
  EmployeeAuthFlow,
  EmployeeMembershipChoice,
  EmployeeProfile,
} from "@/lib/staff-pwa/types";

type OtpRequestResponse = {
  ok: true;
  challengeId: string;
  message: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
};

type OtpVerifyResponse =
  | {
      ok: true;
      status: "AUTHENTICATED";
      expiresAt: string;
    }
  | {
      ok: true;
      status: "MEMBERSHIP_SELECTION_REQUIRED";
      selectionToken: string;
      memberships: EmployeeMembershipChoice[];
    };

export function StaffLoginForm({
  initialMessage = "",
  initialMessageTone = "error",
  testingMode = false,
}: {
  initialMessage?: string;
  initialMessageTone?: "error" | "success";
  testingMode?: boolean;
}) {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [messageTone, setMessageTone] = useState<"error" | "success">(initialMessageTone);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void staffApiFetch<{ ok: true; authenticated: true; profile: EmployeeProfile }>(
      "/api/employee-auth/me",
    )
      .then(() => {
        if (active) router.replace("/staff");
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");

    try {
      const deviceIdentifier = getOrCreateDeviceIdentifier();
      const result = await staffApiFetch<OtpRequestResponse>(
        "/api/employee-auth/request-otp",
        {
          method: "POST",
          body: JSON.stringify({ phoneNumber, deviceIdentifier }),
        },
      );
      const now = Date.now();
      saveEmployeeAuthFlow({
        challengeId: result.challengeId,
        deviceIdentifier,
        expiresAt: now + result.expiresInSeconds * 1_000,
        phoneNumber,
        phoneMasked: maskPhoneForDisplay(phoneNumber),
        resendAt: now + result.resendAfterSeconds * 1_000,
      });
      router.push("/staff/verify");
    } catch (error) {
      setMessageTone("error");
      setMessage(publicAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="staff-auth-card staff-login-card">
      <aside className="staff-login-intro">
        <div>
          <span className="staff-login-symbol" aria-hidden="true">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M12 7v5l3 2" />
              <circle cx="12" cy="12" r="8" />
              <path d="m8.5 3.8 1-1.3h5l1 1.3" />
            </svg>
          </span>
          <p className="staff-kicker">TETAMU STAFF</p>
          <h2>Work made simple.</h2>
          <p>Attendance, requests, commission and payslips in one secure place.</p>
        </div>
        <ul className="staff-login-features">
          <li>
            <span aria-hidden="true">01</span>
            Location is checked only when you clock in or out.
          </li>
          <li>
            <span aria-hidden="true">02</span>
            Your account is protected with one-time verification.
          </li>
        </ul>
        <small>Secure employee portal</small>
      </aside>

      <div className="staff-login-panel">
        <div className="staff-auth-heading staff-login-heading">
          <span className="staff-auth-icon" aria-hidden="true">
            <svg fill="none" viewBox="0 0 24 24">
              <path d="M7 11V8a5 5 0 0 1 10 0v3" />
              <rect height="9" rx="2" width="14" x="5" y="11" />
              <path d="M12 15v2" />
            </svg>
          </span>
          <p className="staff-kicker">STAFF SIGN IN</p>
          <h1>Welcome back</h1>
          <p>Use the mobile number registered by your workplace.</p>
        </div>
        <form className="staff-form-stack" onSubmit={submit} suppressHydrationWarning>
          <label>
            Mobile number
            <div className="staff-phone-input">
              <span>MY</span>
              <input
                autoComplete="tel"
                autoFocus
                inputMode="tel"
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="012 345 6789"
                required
                suppressHydrationWarning
                value={phoneNumber}
              />
            </div>
            <small className="staff-input-hint">Malaysian local and +60 formats are accepted.</small>
          </label>
          {message ? <div className={`staff-alert ${messageTone}`} role="status">{message}</div> : null}
          <button className="staff-primary-button" disabled={busy} type="submit">
            <span>{busy ? "Requesting code…" : "Continue"}</span>
            {!busy ? <b aria-hidden="true">→</b> : null}
          </button>
        </form>
        <p className="staff-security-note">
          <span aria-hidden="true">✓</span>
          Employee accounts are created by your workplace.
        </p>
        {testingMode ? (
          <details className="staff-testing-note">
            <summary>Testing mode</summary>
            <p>Mock OTP is enabled. This is not a Production OTP provider.</p>
          </details>
        ) : null}
      </div>
    </section>
  );
}

export function StaffVerifyForm({
  developmentFastPath = false,
}: {
  developmentFastPath?: boolean;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const verificationInFlightRef = useRef(false);
  const [flow, setFlow] = useState<EmployeeAuthFlow | null>(null);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success">("error");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const stored = readEmployeeAuthFlow();
    if (!stored) {
      router.replace("/staff/login");
      return;
    }
    setFlow(stored);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [router]);

  useEffect(() => {
    if (busy || digits.some((digit) => !digit)) return;
    formRef.current?.requestSubmit();
  }, [busy, digits]);

  if (!flow) {
    return <StaffLoading label="Loading secure verification…" />;
  }
  const activeFlow = flow;

  const secondsRemaining = Math.max(0, Math.ceil((flow.expiresAt - now) / 1_000));
  const resendSeconds = Math.max(0, Math.ceil((flow.resendAt - now) / 1_000));
  const otpError = messageTone === "error" ? message : "";

  function updateDigit(index: number, value: string) {
    const nextValue = value.replace(/\D/g, "").slice(-1);
    setMessage("");
    setDigits((current) => {
      const next = [...current];
      next[index] = nextValue;
      return next;
    });
    if (nextValue && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function keyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    const value = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!value) return;
    event.preventDefault();
    setMessage("");
    setDigits(Array.from({ length: 6 }, (_, index) => value[index] ?? ""));
    inputRefs.current[Math.min(value.length, 6) - 1]?.focus();
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = digits.join("");
    if (
      otp.length !== 6 ||
      busy ||
      verificationInFlightRef.current ||
      (!developmentFastPath && secondsRemaining === 0)
    ) {
      setMessageTone("error");
      setMessage(
        !developmentFastPath && secondsRemaining === 0
          ? "This verification code has expired. Request a new code."
          : "Enter the complete 6-digit verification code.",
      );
      return;
    }
    verificationInFlightRef.current = true;
    setBusy(true);
    setMessage("");

    try {
      const result = await staffApiFetch<OtpVerifyResponse>(
        "/api/employee-auth/verify-otp",
        {
          method: "POST",
          body: JSON.stringify({
            challengeId: activeFlow.challengeId,
            otp,
            deviceIdentifier: activeFlow.deviceIdentifier,
            ...getDeviceMetadata(),
          }),
        },
      );
      setDigits(["", "", "", "", "", ""]);
      if (result.status === "MEMBERSHIP_SELECTION_REQUIRED") {
        const nextFlow = {
          ...activeFlow,
          memberships: result.memberships,
          selectionToken: result.selectionToken,
        };
        saveEmployeeAuthFlow(nextFlow);
        router.replace("/staff/select-workplace");
        return;
      }
      clearEmployeeAuthFlow();
      window.location.replace("/staff");
    } catch (error) {
      const nextFailures = failures + 1;
      setFailures(nextFailures);
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
      setMessageTone("error");
      setMessage(
        !developmentFastPath && nextFailures >= 5
          ? "Verification has been locked for your security. Request a new code or contact your manager."
          : publicAuthMessage(error),
      );
    } finally {
      verificationInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function resend() {
    if (resendSeconds > 0 || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await staffApiFetch<OtpRequestResponse>(
        "/api/employee-auth/request-otp",
        {
          method: "POST",
          body: JSON.stringify({
            phoneNumber: activeFlow.phoneNumber,
            deviceIdentifier: activeFlow.deviceIdentifier,
          }),
        },
      );
      const requestedAt = Date.now();
      const nextFlow = {
        ...activeFlow,
        challengeId: result.challengeId,
        expiresAt: requestedAt + result.expiresInSeconds * 1_000,
        resendAt: requestedAt + result.resendAfterSeconds * 1_000,
      };
      saveEmployeeAuthFlow(nextFlow);
      setFlow(nextFlow);
      setNow(requestedAt);
      setDigits(["", "", "", "", "", ""]);
      setFailures(0);
      setMessageTone("success");
      setMessage(result.message);
    } catch (error) {
      setMessageTone("error");
      setMessage(publicAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function changePhoneNumber() {
    clearEmployeeAuthFlow();
    router.replace("/staff/login");
  }

  return (
    <section className="staff-auth-card staff-verify-card">
      <div className="staff-auth-heading staff-verify-heading">
        <p className="staff-kicker">SECURE SIGN IN</p>
        <h1>Check your phone</h1>
        <p>Enter the 6-digit code sent to <strong>{flow.phoneMasked}</strong>.</p>
      </div>
      <form
        className="staff-form-stack staff-verify-form"
        onSubmit={verify}
        ref={formRef}
      >
        <div
          aria-label="Verification code"
          className="staff-otp-inputs"
          onPaste={paste}
        >
          {digits.map((digit, index) => (
            <input
              aria-label={`Digit ${index + 1}`}
              autoComplete={index === 0 ? "one-time-code" : "off"}
              inputMode="numeric"
              key={index}
              maxLength={1}
              onChange={(event) => updateDigit(index, event.target.value)}
              onKeyDown={(event) => keyDown(index, event)}
              ref={(element) => {
                inputRefs.current[index] = element;
              }}
              value={digit}
            />
          ))}
        </div>
        <div className="staff-code-timer">
          {developmentFastPath ? (
            <>
              <span>Development OTP</span>
              <strong>Ready now</strong>
            </>
          ) : (
            <>
              <span>Expires in</span>
              <strong>{formatCountdown(secondsRemaining)}</strong>
            </>
          )}
        </div>
        <div
          aria-live={otpError ? "assertive" : "polite"}
          className={`staff-otp-auto-status ${busy ? "is-checking" : ""} ${otpError ? "is-error" : ""}`}
          role={otpError ? "alert" : "status"}
        >
          <span aria-hidden="true" />
          <strong>
            {busy ? "Checking code…" : otpError ? "Code not accepted" : "Code checks automatically"}
          </strong>
          <small>
            {busy ? "Please wait" : otpError || "Enter all 6 digits to continue"}
          </small>
        </div>
        {message && messageTone === "success" ? (
          <div className="staff-alert success" role="status">{message}</div>
        ) : null}
        <div className="staff-verify-actions">
          <button
            className="staff-link-button"
            disabled={busy || resendSeconds > 0}
            onClick={resend}
            type="button"
          >
            {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
          </button>
          <span aria-hidden="true">·</span>
          <button
            className="staff-link-button"
            disabled={busy}
            onClick={changePhoneNumber}
            type="button"
          >
            Change number
          </button>
        </div>
      </form>
    </section>
  );
}

export function StaffWorkplaceSelector() {
  const router = useRouter();
  const [flow, setFlow] = useState<EmployeeAuthFlow | null>(null);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [temporaryError, setTemporaryError] = useState(false);
  const [retryMembershipId, setRetryMembershipId] = useState("");

  useEffect(() => {
    const stored = readEmployeeAuthFlow();
    if (!stored?.selectionToken || !stored.memberships?.length) {
      router.replace("/staff/login");
      return;
    }
    setFlow(stored);
  }, [router]);

  if (!flow?.selectionToken || !flow.memberships) {
    return <StaffLoading label="Loading workplaces…" />;
  }

  async function select(membership: EmployeeMembershipChoice) {
    if (!flow?.selectionToken || busyId) return;
    setBusyId(membership.membershipId);
    setMessage("");
    setTemporaryError(false);
    setRetryMembershipId("");
    try {
      await staffApiFetch<{ ok: true; status: "AUTHENTICATED"; expiresAt: string }>(
        "/api/employee-auth/select-membership",
        {
          method: "POST",
          body: JSON.stringify({
            selectionToken: flow.selectionToken,
            membershipId: membership.membershipId,
            deviceIdentifier: flow.deviceIdentifier,
            ...getDeviceMetadata(),
          }),
        },
      );
      clearEmployeeAuthFlow();
      window.location.replace("/staff");
    } catch (error) {
      setMessage(publicAuthMessage(error));
      setTemporaryError(isTemporaryAuthError(error));
      setRetryMembershipId(membership.membershipId);
    } finally {
      setBusyId("");
    }
  }

  function retry() {
    const membership = flow?.memberships?.find(
      (item) => item.membershipId === retryMembershipId,
    );
    if (membership) void select(membership);
  }

  return (
    <section className="staff-auth-card staff-workplace-card">
      <div className="staff-auth-heading">
        <p className="staff-kicker">WORKPLACE</p>
        <h1>Where are you working?</h1>
        <p>Select the employer for this secure Staff Session.</p>
      </div>
      <div className="staff-workplace-list">
        {flow.memberships.map((membership) => {
          const showBranchName = normalizeLabel(membership.primaryBranchName)
            !== normalizeLabel(membership.businessName);

          return (
            <button
              disabled={Boolean(busyId)}
              key={membership.membershipId}
              onClick={() => select(membership)}
              type="button"
            >
              <span className="staff-workplace-mark" aria-hidden="true">T</span>
              <span>
                <strong>{membership.businessName}</strong>
                {showBranchName ? <small>{membership.primaryBranchName}</small> : null}
              </span>
              <b>{busyId === membership.membershipId ? "…" : "›"}</b>
            </button>
          );
        })}
      </div>
      {message && temporaryError ? (
        <div className="staff-auth-service-alert" role="alert">
          <span className="staff-auth-service-icon" aria-hidden="true">↻</span>
          <div>
            <strong>Connection interrupted</strong>
            <p>{message}</p>
          </div>
          <button disabled={Boolean(busyId)} onClick={retry} type="button">
            {busyId ? "Trying…" : "Try again"}
          </button>
        </div>
      ) : message ? (
        <div className="staff-alert error" role="alert">{message}</div>
      ) : null}
    </section>
  );
}

export function StaffLoading({ label }: { label: string }) {
  return (
    <div aria-live="polite" className="staff-loading-card">
      <span className="staff-spinner" />
      <p>{label}</p>
    </div>
  );
}

function publicAuthMessage(error: unknown) {
  if (error instanceof StaffApiError) {
    if (
      ["EMPLOYEE_INACTIVE", "MEMBERSHIP_INACTIVE", "ATTENDANCE_DISABLED", "MEMBERSHIP_NOT_AVAILABLE"].includes(
        error.code,
      )
    ) {
      return "Your employee profile is not enabled. Please contact your administrator.";
    }
    if (error.code === "OTP_INVALID") {
      return "Incorrect OTP. Please try again.";
    }
    if (error.code === "OTP_EXPIRED") {
      return "This verification code has expired. Request a new code.";
    }
    if (error.code === "OTP_LOCKED") {
      return "Too many invalid attempts. Request a new verification code.";
    }
    if (error.code === "OTP_PROVIDER_UNAVAILABLE") {
      return "We can’t reach verification right now. Your account is safe—please try again.";
    }
    if (error.code === "RATE_LIMITED") {
      return "Too many attempts. Please wait before trying again.";
    }
    if (error.code === "CONFIGURATION_ERROR" || error.code === "REQUEST_FAILED") {
      return "We can’t connect to the Staff service right now. Your account is safe—please try again.";
    }
    if (error.code === "NETWORK_ERROR") {
      return "Check your internet connection, then try again.";
    }
    return error.message;
  }
  return "Unable to continue. Please try again.";
}

function isTemporaryAuthError(error: unknown) {
  return error instanceof StaffApiError && [
    "CONFIGURATION_ERROR",
    "NETWORK_ERROR",
    "OTP_PROVIDER_UNAVAILABLE",
    "REQUEST_FAILED",
  ].includes(error.code);
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function normalizeLabel(value: string) {
  return value.trim().toLocaleLowerCase();
}
