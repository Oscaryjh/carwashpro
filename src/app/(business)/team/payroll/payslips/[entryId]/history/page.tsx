import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWholeBusinessPayroll } from "@/lib/payroll/access";
import { prisma } from "@/lib/prisma";
import { assertWholeBusinessPcbAuthority, manualPcbInputDigest } from "@/lib/payroll/manual-pcb-service";
import { isMfaFeatureEnabled } from "@/lib/auth/mfa-feature";
import { ManualPcbFields } from "@/components/manual-pcb-fields";
import { correctPublishedPcbAction } from "../../../actions";
import { validPcbSettlementComponents } from "@/lib/payroll/pcb-correction-settlement";
import { correctionSettlementState } from "@/lib/payroll/pcb-correction-contract";

export const dynamic = "force-dynamic";

export default async function PayslipHistoryPage({ params }: { params: Promise<{ entryId: string }> }) {
  const context = await requireWholeBusinessPayroll("VIEW_PAYSLIP");
  const { entryId } = await params;
  const publication = await prisma.payrollPayslipPublication.findFirst({ where: { payrollEntryId: entryId, businessId: context.businessId }, include: { payrollRun: true, payrollEntry: true, membership: { select: { status: true } } } });
  if (!publication) notFound();
  const versions = await prisma.payrollPcbPublicationVersion.findMany({ where: { businessId: context.businessId, publicationId: publication.id }, orderBy: { version: "asc" } });
  let canCorrect = false;
  try { await prisma.$transaction((tx) => assertWholeBusinessPcbAuthority(tx, context.businessId, context.user.userId)); canCorrect = true; }
  catch (error) { if (!(error instanceof Error) || !["PCB_MANUAL_PERMISSION_DENIED", "MODULE_NOT_ENABLED"].includes(error.message)) throw error; }
  const latest = versions.at(-1);
  const nextRun = await prisma.payrollRun.findFirst({ where: { businessId: context.businessId, status: { in: ["DRAFT", "REVIEW"] },
    periodStart: { gt: publication.payrollRun.periodStart }, entries: { some: { membershipId: publication.membershipId } } }, orderBy: { periodStart: "asc" }, select: { status: true } });
  const applied = new Set((await validPcbSettlementComponents(prisma, context.businessId, versions.map((v) => v.id))).map((line) => line.sourceId));
  const settlementState = (id: string) => correctionSettlementState({ activeEmployee: publication.membership.status === "ACTIVE",
    hasNextRun: nextRun?.status === "REVIEW", applied: applied.has(id) });
  return <main className="content hr-module-page">
    <h1>Payslip history &amp; PCB correction</h1>
    <p>{publication.payrollEntry.fullNameSnapshot} · {publication.payrollRun.periodStart.toISOString().slice(0, 7)}</p>
    <p>Original payroll and PDF are immutable. Staff see the latest published version.</p>
    <Link href={`/team/payroll/runs/${publication.payrollRunId}`}>Back to payroll run</Link>
    <ol>{versions.map((version) => <li key={version.id}>
      <h2>{version.version === 1 ? "Original" : "Corrected — supersedes previous version"} · version {version.version}</h2>
      <p>PCB RM {version.amount.toFixed(2)} · {version.recordedAt.toISOString()} · {version.externalReference}</p>
      <p>{version.reason}</p>
      {version.version > 1 && <p>Prior-period PCB adjustment: RM {version.delta.toFixed(2)} · {settlementState(version.id)}. Not proof of payment.</p>}
      <Link href={`/team/payroll/payslips/${entryId}?version=${version.version}`}>View version {version.version} PDF</Link>
    </li>)}</ol>
    {!latest && <p>Original PDF remains available. This historical publication has no frozen correction source and cannot be corrected through this workflow.</p>}
    {canCorrect && latest && isMfaFeatureEnabled() && <section aria-label="Correct published PCB">
      <h2>Publish a PCB correction</h2>
      <form action={correctPublishedPcbAction}>
        <input type="hidden" name="publicationId" value={publication.id} />
        <input type="hidden" name="runId" value={publication.payrollRunId} />
        <input type="hidden" name="month" value={latest.payrollMonth} />
        <input type="hidden" name="expectedVersion" value={latest.version} />
        <input type="hidden" name="expectedInputDigest" value={await manualPcbInputDigest(prisma, context.businessId, entryId)} />
        <ManualPcbFields historical />
        <button type="submit">Publish corrected payslip</button>
      </form>
    </section>}
  </main>;
}
