import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import {
  loadStatutoryHumanReviewPackages,
  type EvidencePackScheme,
  type StatutoryClassificationReviewEntry,
} from "@/lib/payroll/statutory-evidence-pack";
import {
  STATUTORY_REVIEW_CHECKLIST,
  STATUTORY_REVIEW_CHECKLIST_VERSION,
} from "@/lib/payroll/statutory-human-review";
import { prisma } from "@/lib/prisma";

type Props = { params: Promise<{ scheme: string }> };
const schemeOrder: EvidencePackScheme[] = ["EPF", "SOCSO", "EIS", "LINDUNG24"];

export default async function StatutoryHumanReviewPage({ params }: Props) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const requestedScheme = (await params).scheme.toUpperCase();
  if (!isEvidencePackScheme(requestedScheme)) notFound();

  const [packages, canonicalRuleSets] = await Promise.all([
    loadStatutoryHumanReviewPackages(),
    prisma.statutoryRuleSet.findMany({
      where: { scheme: requestedScheme },
      select: { id: true, version: true, status: true },
      orderBy: { recordedAt: "desc" },
    }),
  ]);
  const pack = packages.find((item) => item.scheme === requestedScheme);
  if (!pack) notFound();
  const reviewPosition = schemeOrder.indexOf(pack.scheme) + 1;
  const matrix = classificationMatrix(packages.flatMap((item) => item.classification.entries));

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <p><Link href="/admin/statutory/rulesets">Statutory rules</Link></p>
            <h1>{pack.scheme} human review package</h1>
            <p>Review {reviewPosition} of {schemeOrder.length}. Evidence presentation only; nothing on this page signs or activates a rule.</p>
          </div>
        </div>

        <div className="panel">
          <h2>Review order</h2>
          <p>{schemeOrder.map((scheme, index) => (
            <span key={scheme}>
              {index ? " → " : ""}
              {scheme === pack.scheme ? <strong>{scheme}</strong> : <Link href={`/admin/statutory/review/${scheme.toLowerCase()}`}>{scheme}</Link>}
            </span>
          ))}</p>
        </div>

        <div className="panel">
          <h2>Current status</h2>
          <dl>
            <dt>Engineering</dt><dd>{pack.engineering}</dd>
            <dt>Evidence pack</dt><dd>{pack.evidencePack}</dd>
            <dt>Human review</dt><dd>{pack.humanReview}</dd>
            <dt>Human sign-off</dt><dd>{pack.humanSignOff}</dd>
            <dt>Activation</dt><dd>{pack.activation}</dd>
            <dt>Environment</dt><dd>LOCAL / TESTING ONLY</dd>
          </dl>
          <p><strong>Codex is not the Human Reviewer.</strong> An authorised authenticated person must make every legal classification and sign-off decision.</p>
        </div>

        <div className="panel">
          <h2>Official evidence identity</h2>
          <p>Effective period: <strong>{pack.effectiveFrom} – {pack.effectiveTo ?? "open"}</strong></p>
          <table className="table">
            <thead><tr><th>Publisher / document</th><th>Role</th><th>Retained artifact</th><th>SHA-256</th><th>Integrity</th></tr></thead>
            <tbody>{pack.artifacts.map((artifact) => (
              <tr key={artifact.id}>
                <td><strong>{artifact.authority}</strong><br/>{artifact.title}<br/><span className="muted">{artifact.version}</span></td>
                <td>{artifact.role}</td>
                <td><code>{artifact.retainedPath ?? "MISSING"}</code></td>
                <td><code>{artifact.sha256 ?? "MISSING"}</code></td>
                <td>{artifact.verified ? "VERIFIED" : "BLOCKED"}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="muted">Official URLs are provenance metadata only; retained bytes are the deterministic review input.</p>
        </div>

        <div className="panel">
          <h2>Dataset and independent review</h2>
          <dl>
            <dt>Dataset</dt><dd>{pack.dataset.id}</dd>
            <dt>Dataset digest</dt><dd><code>{pack.dataset.digest}</code></dd>
            <dt>Parser</dt><dd>{pack.dataset.parserName} {pack.dataset.parserVersion}</dd>
            <dt>Dataset rows</dt><dd>{pack.dataset.actualRowCount} actual / {pack.dataset.expectedRowCount} expected</dd>
            <dt>Independent rows reviewed</dt><dd>{pack.independentReview.rowsChecked}</dd>
            <dt>Mismatch count</dt><dd>{pack.independentReview.mismatchCount}</dd>
            <dt>Independent review</dt><dd>{pack.independentReview.status} · {pack.independentReview.method} · {pack.independentReview.reviewerType}</dd>
            <dt>Review digest</dt><dd><code>{pack.independentReview.digest}</code></dd>
          </dl>
          <table className="table">
            <thead><tr><th>Reviewed range</th><th>Official pages</th></tr></thead>
            <tbody>{pack.independentReview.ranges.map((range) => (
              <tr key={`${range.from}-${range.to}`}><td>{range.from} – {range.to}</td><td>{range.sourcePages.join(", ") || "Recorded in source reference"}</td></tr>
            ))}</tbody>
          </table>
          <p className="muted">This independent engineering review is not the statutory Human Sign-off.</p>
        </div>

        <div className="panel">
          <h2>Calculation behavior</h2>
          <dl>
            <dt>Calculator version</dt><dd>{pack.calculator.version}</dd>
            <dt>Calculator test digest</dt><dd><code>{pack.calculator.testDigest}</code></dd>
            <dt>Calculation mode</dt><dd>{pack.dataset.calculationMode ?? "Official table lookup"}</dd>
            <dt>Formula above</dt><dd>{pack.dataset.formulaAboveCents === null ? "Defined by scheme calculator / table" : money(pack.dataset.formulaAboveCents)}</dd>
            <dt>Rounding</dt><dd>{pack.dataset.rounding ?? "Defined by verified calculator and fixtures"}</dd>
            <dt>Category rules</dt><dd><code>{pack.dataset.categoryRules ? JSON.stringify(pack.dataset.categoryRules) : "Scheme calculator eligibility/category rules"}</code></dd>
          </dl>
        </div>

        <div className="panel">
          <h2>Official-backed fixtures and traces</h2>
          <p>{pack.fixtures.length} fixtures · {pack.fixtureProvenance.OFFICIAL_BACKED} official-backed · {pack.fixtureProvenance.MISSING} missing provenance</p>
          <table className="table">
            <thead><tr><th>Case / provenance</th><th>Input</th><th>Expected contribution and matched rule</th></tr></thead>
            <tbody>{pack.fixtures.map((fixture) => (
              <tr key={fixture.id}>
                <td><strong>{fixture.id}</strong><br/><span className="muted">{fixture.sourceReference}</span></td>
                <td><code>{JSON.stringify(fixture.input)}</code></td>
                <td><code>{JSON.stringify(fixture.expected)}</code></td>
              </tr>
            ))}</tbody>
          </table>
          <p>Fixture digest: <code>{pack.fixtureDigest}</code></p>
          <p>Certification digest: <code>{pack.fixtureCertificationDigest}</code></p>
        </div>

        <div className="panel">
          <h2>Component classification matrix</h2>
          <p>Current engineering interpretation only. Blank cells mean this candidate does not define that scheme. Reviewer decision remains NOT EXECUTED.</p>
          <table className="table">
            <thead><tr><th>Component</th><th>EPF</th><th>SOCSO</th><th>EIS</th><th>LINDUNG24</th><th>Evidence / reason</th><th>Reviewer decision</th></tr></thead>
            <tbody>{matrix.map((entry) => (
              <tr key={entry.componentCode}>
                <td><strong>{entry.componentCode}</strong><br/><span className="muted">{entry.displayName}</span></td>
                <td>{entry.treatments.EPF ?? "—"}</td><td>{entry.treatments.SOCSO ?? "—"}</td><td>{entry.treatments.EIS ?? "—"}</td><td>{entry.treatments.LINDUNG24 ?? "—"}</td>
                <td>{entry.officialEvidence.length ? entry.officialEvidence.join(", ") : "No component-specific official reference recorded"}<br/><span className="muted">{entry.reason}</span></td>
                <td>NOT EXECUTED</td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div className="panel">
          <h2>{pack.scheme} UNKNOWN inventory</h2>
          <p><strong>{pack.unknownComponents.length} unresolved components.</strong> The current architecture treats each UNKNOWN as a global activation blocker and fails closed if used at runtime. No item is forced to INCLUDED or EXCLUDED.</p>
          <table className="table">
            <thead><tr><th>Component / rule</th><th>Current classification</th><th>Evidence</th><th>Decision required</th><th>Blocking scope</th></tr></thead>
            <tbody>{pack.unknownComponents.map((component) => {
              const entry = pack.classification.entries.find((item) => item.componentCode === component);
              return <tr key={component}>
                <td>{component}</td><td>UNKNOWN</td>
                <td>{entry?.officialEvidence.join(", ") || entry?.reason || "Insufficient official component-specific evidence"}</td>
                <td>Authorised human may retain UNKNOWN or create a new evidence-backed classification revision</td>
                <td>GLOBAL_ACTIVATION_BLOCKER under current policy; runtime fail-closed</td>
              </tr>;
            })}</tbody>
          </table>
          <p><strong>ARREARS:</strong> treatment must derive from the original source component. Unknown source nature remains <code>ARREARS_STATUTORY_SOURCE_NATURE_REQUIRED</code>.</p>
        </div>

        <div className="panel">
          <h2>Known limitations and horizon</h2>
          <ul>{pack.knownLimitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          {pack.scheme === "LINDUNG24" ? <p><strong>CURRENT VERIFIED SCHEDULE HORIZON:</strong> a new official schedule is required before 2028-06-01.</p> : null}
          <p>Evidence digest: <code>{pack.evidenceDigest}</code></p>
        </div>

        <div className="panel">
          <h2>Authorised human checklist</h2>
          <p>Checklist {STATUTORY_REVIEW_CHECKLIST_VERSION}. These boxes are deliberately unchecked and are not persisted by this evidence-only page.</p>
          <fieldset>
            <legend>{pack.scheme} review confirmations</legend>
            {STATUTORY_REVIEW_CHECKLIST.map((item) => (
              <label key={item.id} style={{ display: "block", marginBottom: "0.5rem" }}>
                <input type="checkbox" /> {item.label}
              </label>
            ))}
          </fieldset>
        </div>

        <div className="panel">
          <h2>Decision boundary</h2>
          {canonicalRuleSets.length ? (
            <>
              <p>A canonical RuleSet exists. Sign-off must be performed separately against its unchanged digest by an authorised human.</p>
              <ul>{canonicalRuleSets.map((rule) => <li key={rule.id}><Link href={`/admin/statutory/rulesets/${rule.id}`}>{rule.version} · {rule.status}</Link></li>)}</ul>
            </>
          ) : (
            <p><strong>HUMAN REVIEW PACKAGE READY.</strong> No canonical {pack.scheme} RuleSet is registered, so sign-off is unavailable. Classification resolution and canonical revision registration must be completed through the governed workflow before any authenticated sign-off.</p>
          )}
          <button disabled>Sign-off unavailable on evidence-only package</button>
          <p className="muted">No direct SQL, seed, manual database update, bulk approval or activation is available here.</p>
        </div>
      </section>
    </AppShell>
  );
}

function isEvidencePackScheme(value: string): value is EvidencePackScheme {
  return schemeOrder.includes(value as EvidencePackScheme);
}

function classificationMatrix(entries: StatutoryClassificationReviewEntry[]) {
  const matrix = new Map<string, StatutoryClassificationReviewEntry>();
  for (const entry of entries) {
    const existing = matrix.get(entry.componentCode);
    if (!existing) {
      matrix.set(entry.componentCode, structuredClone(entry));
      continue;
    }
    existing.treatments = { ...existing.treatments, ...entry.treatments };
    existing.officialEvidence = [...new Set([...existing.officialEvidence, ...entry.officialEvidence])];
    if (!existing.reason.includes(entry.reason)) existing.reason += ` ${entry.reason}`;
  }
  return [...matrix.values()].sort((a, b) => a.componentCode.localeCompare(b.componentCode));
}

function money(cents: number) {
  return `MYR ${(cents / 100).toFixed(2)}`;
}
