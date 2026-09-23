import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { readSnapshot } from "./read";
import { assertPerformanceActor, type PerformanceActor } from "./scope";
import { performancePeriod, performanceTimezone } from "./time";
import { targetDraftSchema, targetGap, progress, teamLevel, type TargetDraft, type TargetSnapshot } from "./targets-contract";

export function assertTargetsEnabled() {
  if (process.env.TETAMU_PERFORMANCE_PHASE2 !== "true") throw new Error("业绩目标功能尚未启用。");
}
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function signature(payload: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Target preview signing is not configured.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
export async function targetMembers(tx: Prisma.TransactionClient, context: PerformanceActor, year: number) {
  const business = await tx.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { timezone: true } });
  const range = performancePeriod(year, performanceTimezone(business.timezone));
  return tx.employeeBusinessMembership.findMany({ where: { businessId: context.businessId, branchAssignments: { some: {
    businessId: context.businessId, branchId: context.branchId, effectiveFrom: { lt: range.toExclusive },
    OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: range.from } }],
  } } }, select: { id: true, fullName: true, employeeCode: true, status: true }, orderBy: [{ employeeCode: "asc" }, { id: "asc" }] });
}
export async function currentTarget(tx: Prisma.TransactionClient, context: PerformanceActor, year: number) {
  return tx.performanceTargetVersion.findFirst({ where: { businessId: context.businessId, branchId: context.branchId, year }, orderBy: { revision: "desc" } });
}
async function buildPreview(tx: Prisma.TransactionClient, context: PerformanceActor, draft: TargetDraft, asOf: Date) {
  const actor = await assertPerformanceActor(tx, context, "PERFORMANCE_MANAGE_TARGETS");
  const previous = await currentTarget(tx, context, draft.year);
  if ((previous?.revision ?? 0) !== draft.expectedRevision) throw new Error("目标版本已改变，请重新加载并预览。");
  const members = await targetMembers(tx, context, draft.year);
  const old = previous?.snapshot as TargetSnapshot | undefined;
  // Retain former staff already in the branch's published target, even if assignment metadata changed later.
  const retainedIds = old?.people.map(p => p.membershipId) ?? [];
  const retained = retainedIds.length ? await tx.employeeBusinessMembership.findMany({ where: { businessId: context.businessId, id: { in: retainedIds } },
    select: { id: true, fullName: true, employeeCode: true, status: true } }) : [];
  const eligible = new Map([...retained, ...members].map(m => [m.id, m]));
  const people = draft.people.map(p => {
    const member = eligible.get(p.membershipId);
    if (!member) throw new Error("员工不属于该门店及年度，请检查成员变化。");
    return { ...p, fullName: member.fullName, employeeCode: member.employeeCode, status: member.status };
  }).sort((a,b) => a.membershipId.localeCompare(b.membershipId));
  const next: TargetSnapshot = { levels: draft.levels, managerId: draft.managerId, people, gap: targetGap(draft.levels[0], people) };
  const ledger = await readSnapshot(context, { year: draft.year, asOf }, tx);
  const complete = ledger.coverageStatus === "COMPLETE" && asOf >= ledger.period.from;
  const unassigned = ledger.details.some(e => e.verified && e.allocations.some(a => a.membershipId === null && (a.salesReceived || a.tipsReceived || a.refunds)));
  const impact = (snapshot?: TargetSnapshot) => ({
    level: teamLevel(ledger.team.total, snapshot?.levels ?? null, complete),
    team: progress(ledger.team.total, snapshot?.levels[0] ?? null, complete),
    people: (snapshot?.people ?? []).map(p => ({ membershipId: p.membershipId, ...progress(ledger.employees[p.membershipId]?.total ?? 0, p.amount, complete && !unassigned) })),
  });
  return { actorName: actor.name, previous: old ?? null, next, before: impact(old), after: impact(next), asOf: asOf.toISOString(),
    coverageStatus: ledger.coverageStatus, unassignedAmount: ledger.unassignedAmount, personalAllocationIncomplete: unassigned,
    expectedRevision: draft.expectedRevision };
}
export async function previewTargets(context: PerformanceActor, value: unknown, db: PrismaClient = prisma, now = new Date()) {
  assertTargetsEnabled(); const draft = targetDraftSchema.parse(value);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const preview = await buildPreview(tx, context, draft, now);
    const payload = Buffer.from(JSON.stringify({ context, draftHash: digest(draft), previewHash: digest(preview), asOf: now.toISOString(), expires: now.getTime() + 20*60*1000 })).toString("base64url");
    return { preview, token: payload + "." + signature(payload) };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}
export async function publishTargets(context: PerformanceActor, value: unknown, token: string, requestKey: string, db: PrismaClient = prisma) {
  assertTargetsEnabled(); const draft = targetDraftSchema.parse(value);
  if (!/^[0-9a-f-]{36}$/i.test(requestKey)) throw new Error("Invalid request key.");
  const [payload, sig = ""] = token.split(".");
  if (!payload || Buffer.byteLength(token) > 12000) throw new Error("请先完成发布预览。");
  const expected = signature(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error("预览凭证无效。");
  const signed = JSON.parse(Buffer.from(payload, "base64url").toString());
  if (digest(signed.context) !== digest(context) || signed.draftHash !== digest(draft)) throw new Error("预览已失效，请重新预览。");
  const fingerprint = digest({ draft, token });
  for (let attempt = 0; ; attempt++) { try { return await db.$transaction(async tx => {
    await assertPerformanceActor(tx, context, "PERFORMANCE_MANAGE_TARGETS");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${context.businessId + ":" + context.branchId + ":" + draft.year}, 0))`;
    const replay = await tx.performanceTargetVersion.findUnique({ where: { businessId_requestKey: { businessId: context.businessId, requestKey } } });
    if (replay) {
      if (replay.fingerprint !== fingerprint || replay.actorUserId !== context.actorUserId || replay.branchId !== context.branchId) throw new Error("重复请求内容不一致。");
      return { id: replay.id, revision: replay.revision };
    }
    if (signed.expires < Date.now()) throw new Error("预览已过期，请重新预览。");
    const preview = await buildPreview(tx, context, draft, new Date(signed.asOf));
    if (digest(preview) !== signed.previewHash) throw new Error("业绩、成员或权限已改变，请重新预览。");
    if (preview.next.gap !== 0 && !draft.confirmGap) throw new Error("请明确确认目标分配差额。");
    const saved = await tx.performanceTargetVersion.create({ data: {
      businessId: context.businessId, branchId: context.branchId, actorUserId: context.actorUserId, actorName: preview.actorName,
      year: draft.year, revision: draft.expectedRevision + 1, requestKey, fingerprint, reason: draft.reason,
      snapshot: preview.next as unknown as Prisma.InputJsonValue, previousSnapshot: preview.previous ?? Prisma.JsonNull,
      preview: preview as unknown as Prisma.InputJsonValue,
    } });
    await tx.auditLog.create({ data: { businessId: context.businessId, branchId: context.branchId, actorUserId: context.actorUserId,
      actorName: preview.actorName, summary: draft.reason,
      action: "PERFORMANCE_TARGET_PUBLISHED", entityType: "PerformanceTargetVersion", entityId: saved.id,
      metadata: { revision: saved.revision, year: saved.year, reason: draft.reason, requestKey, actualPerformanceUnchanged: true } } });
    return { id: saved.id, revision: saved.revision };
  }, { isolationLevel: "Serializable", timeout: 30_000 });
  } catch (error) {
    if (attempt < 2 && error instanceof Prisma.PrismaClientKnownRequestError && ["P2034", "P2002"].includes(error.code)) continue;
    throw error;
  } }
}
