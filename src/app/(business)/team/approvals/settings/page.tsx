import Link from "next/link";
import { notFound } from "next/navigation";
import { getHrApprovalPolicies, type HrApprovalDomainName } from "@/lib/approvals/policy-service";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { saveApprovalPolicyAction } from "./actions";
import styles from "./settings.module.css";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ type?: string; message?: string }> };

const domainCopy: Record<HrApprovalDomainName, { title: string; description: string; unit: string; example: string }> = {
  LEAVE: {
    title: "Leave requests",
    description: "Use the requested number of leave days to decide whether owner approval is needed.",
    unit: "days",
    example: "Example: 3 means requests for 3 days or more need owner approval.",
  },
  CLAIMS: {
    title: "Employee claims",
    description: "Use the submitted claim amount to decide whether owner approval is needed.",
    unit: "MYR",
    example: "Example: RM500 means claims of RM500 or more need owner approval.",
  },
};

export default async function ApprovalSettingsPage({ searchParams }: PageProps) {
  const { access, businessId } = await requireBusinessUser();
  if (access.effectiveBusinessRole !== "BUSINESS_OWNER") notFound();
  const [policies, params] = await Promise.all([getHrApprovalPolicies(businessId), searchParams]);

  return (
    <main className={`content hr-module-page ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <p>PEOPLE &amp; HR</p>
          <h1>Approval workflow</h1>
          <span>Choose when a manager decision is enough and when the owner must give final approval.</span>
        </div>
        <Link href="/team/approvals">Back to approvals</Link>
      </header>

      {params.message ? <div className={params.type === "error" ? styles.error : styles.success} role="status">{params.message}</div> : null}

      <section className={styles.explainer}>
        <div><strong>1</strong><span><b>Employee submits</b><small>The original Leave or Claim record remains the source of truth.</small></span></div>
        <div><strong>2</strong><span><b>Manager reviews</b><small>Managers handle normal requests within their permission.</small></span></div>
        <div><strong>3</strong><span><b>Owner approves when required</b><small>Only configured high-risk requests receive a second approval.</small></span></div>
      </section>

      <section className={styles.grid}>
        {(["LEAVE", "CLAIMS"] as const).map((domain) => {
          const policy = policies[domain];
          const copy = domainCopy[domain];
          return (
            <form action={saveApprovalPolicyAction} className={styles.card} key={domain}>
              <input name="domain" type="hidden" value={domain} />
              <div className={styles.cardHeading}>
                <div><p>{domain}</p><h2>{copy.title}</h2><span>{copy.description}</span></div>
                <span className={styles.current}>{modeLabel(policy.mode)}</span>
              </div>
              <label>
                Approval level
                <select defaultValue={policy.mode} name="mode">
                  <option value="ONE_LEVEL">Manager approval only</option>
                  <option value="TWO_LEVEL_ALWAYS">Manager + owner for every request</option>
                  <option value="TWO_LEVEL_THRESHOLD">Manager + owner above a threshold</option>
                </select>
              </label>
              <label>
                Second-level threshold ({copy.unit})
                <input
                  defaultValue={policy.thresholdValue ?? ""}
                  inputMode="decimal"
                  min="0.01"
                  name="thresholdValue"
                  placeholder={domain === "CLAIMS" ? "500.00" : "3"}
                  step={domain === "CLAIMS" ? "0.01" : "0.5"}
                  type="number"
                />
                <small>This value is used only when “above a threshold” is selected. {copy.example}</small>
              </label>
              <div className={styles.boundary}>
                <strong>Approval separation</strong>
                <span>A manager completes Level 1. A Business Owner completes Level 2. The same person cannot complete both levels.</span>
              </div>
              <button type="submit">Save workflow</button>
            </form>
          );
        })}
      </section>
    </main>
  );
}

function modeLabel(mode: string) {
  if (mode === "TWO_LEVEL_ALWAYS") return "Always 2 levels";
  if (mode === "TWO_LEVEL_THRESHOLD") return "Threshold-based";
  return "1 level";
}
