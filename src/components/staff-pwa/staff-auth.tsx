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
  formatPhoneForConfirmation,
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

export function StaffLoginForm({ initialMessage = "", testingMode = false }: { initialMessage?: string; testingMode?: boolean }) {
  const router = useRouter();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [message, setMessage] = useState(initialMessage);
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
          <p className="staff-kicker">EMPLOYEE ACCESS</p>
          <h1>Sign in to Staff App</h1>
          <p>Enter the mobile number registered by your HR administrator.</p>
        </div>
        <form className="staff-form-stack" onSubmit={submit}>
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
                value={phoneNumber}
              />
            </div>
            <small className="staff-input-hint">
              Malaysian local and +60 formats are accepted.
            </small>
          </label>
          {message ? <div className="staff-alert error" role="alert">{message}</div> : null}
          <button className="staff-primary-button" disabled={busy} type="submit">
            <span>{busy ? "Requesting code…" : "Request verification code"}</span>
            {!busy ? <b aria-hidden="true">→</b> : null}
          </button>
        </form>
        <p className="staff-security-note">
          <span aria-hidden="true">✓</span>
          No self-registration. Contact your manager if your employee access is not enabled.
        </p>
        {testingMode ? (
          <p className="staff-alert warning" role="note">
            Local / Testing mock OTP is enabled. It is not a Production OTP provider.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function StaffVerifyForm() {
  const router = useRouter();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [flow, setFlow] = useState<EmployeeAuthFlow | null>(null);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [message, setMessage] = useState("");
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

  if (!flow) {
    return <StaffLoading label="Loading secure verification…" />;
  }
  const activeFlow = flow;

  const secondsRemaining = Math.max(0, Math.ceil((flow.expiresAt - now) / 1_000));
  const resendSeconds = Math.max(0, Math.ceil((flow.resendAt - now) / 1_000));

  function updateDigit(index: number, value: string) {
    const nextValue = value.replace(/\D/g, "").slice(-1);
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
    setDigits(Array.from({ length: 6 }, (_, index) => value[index] ?? ""));
    inputRefs.current[Math.min(value.length, 6) - 1]?.focus();
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const otp = digits.join("");
    if (otp.length !== 6 || busy || secondsRemaining === 0) {
      setMessage(
        secondsRemaining === 0
          ? "This verification code has expired. Request a new code."
          : "Enter the complete 6-digit verification code.",
      );
      return;
    }
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
      setMessage(
        nextFailures >= 5
          ? "Verification has been locked for your security. Request a new code or contact your manager."
          : publicAuthMessage(error),
      );
    } finally {
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
      setMessage(result.message);
    } catch (error) {
      setMessage(publicAuthMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function changePhoneNumber() {
    if (busy) return;
    clearEmployeeAuthFlow();
    router.replace("/staff/login");
  }

  return (
    <section className="staff-auth-card staff-verify-card">
      <div className="staff-auth-heading">
        <p className="staff-kicker">SECURE VERIFICATION</p>
        <h1>Enter your 6-digit code</h1>
        <p>Enter the SMS code sent to the mobile number below.</p>
      </div>
      <div className="staff-phone-confirmation" role="note">
        <span className="staff-phone-confirmation-icon" aria-hidden="true">
          <svg fill="none" viewBox="0 0 24 24">
            <rect height="18" rx="3" width="12" x="6" y="3" />
            <path d="M10 6h4M11 18h2" />
          </svg>
        </span>
        <span className="staff-phone-confirmation-copy">
          <small>Mobile number</small>
          <strong>
            {activeFlow.phoneNumber
              ? formatPhoneForConfirmation(activeFlow.phoneNumber)
              : activeFlow.phoneMasked}
          </strong>
          <span>Check the full number before entering your code.</span>
        </span>
        <button disabled={busy} onClick={changePhoneNumber} type="button">
          Change
        </button>
      </div>
      <form className="staff-form-stack" onSubmit={verify}>
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
          <span>Code expires in</span>
          <strong>{formatCountdown(secondsRemaining)}</strong>
        </div>
        {message ? <div className="staff-alert" role="alert">{message}</div> : null}
        <button className="staff-primary-button" disabled={busy} type="submit">
          {busy ? "Verifying…" : "Verify and continue"}
        </button>
        <button
          className="staff-link-button"
          disabled={busy || resendSeconds > 0}
          onClick={resend}
          type="button"
        >
          {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
        </button>
      </form>
    </section>
  );
}

export function StaffWorkplaceSelector() {
  const router = useRouter();
  const [flow, setFlow] = useState<EmployeeAuthFlow | null>(null);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");

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
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="staff-auth-card staff-workplace-card">
      <div className="staff-auth-heading">
        <p className="staff-kicker">WORKPLACE</p>
        <h1>Where are you working?</h1>
        <p>Select the employer for this secure Staff Session.</p>
      </div>
      <div className="staff-workplace-list">
        {flow.memberships.map((membership) => (
          <button
            disabled={Boolean(busyId)}
            key={membership.membershipId}
            onClick={() => select(membership)}
            type="button"
          >
            <span className="staff-workplace-mark" aria-hidden="true">T</span>
            <span>
              <strong>{membership.businessName}</strong>
              <small>{membership.primaryBranchName} · {membership.employeeCode}</small>
            </span>
            <b>{busyId === membership.membershipId ? "…" : "›"}</b>
          </button>
        ))}
      </div>
      {message ? <div className="staff-alert error" role="alert">{message}</div> : null}
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
      return "The verification code is invalid.";
    }
    if (error.code === "OTP_EXPIRED") {
      return "This verification code has expired. Request a new code.";
    }
    if (error.code === "OTP_LOCKED") {
      return "Too many invalid attempts. Request a new verification code.";
    }
    if (error.code === "OTP_PROVIDER_UNAVAILABLE") {
      return "Verification service is temporarily unavailable. Please try again later.";
    }
    if (error.code === "RATE_LIMITED") {
      return "Too many attempts. Please wait before trying again.";
    }
    return error.message;
  }
  return "Unable to continue. Please try again.";
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
