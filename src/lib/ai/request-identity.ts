import { createHash } from "node:crypto";

export function aiRequestFingerprint(input: {
  actorUserId: string; businessId: string; conversationId?: string | null;
  question: string; range?: string; from?: string; to?: string;
  branch: { kind: "absent" } | { kind: "explicit"; value: string | null | undefined };
}) {
  return createHash("sha256").update(JSON.stringify({
    version: "owner-pilot-request/1", actorUserId: input.actorUserId, businessId: input.businessId,
    conversation: input.conversationId ? { id: input.conversationId } : { new: true },
    question: input.question.trim(), range: input.range ?? "month", from: input.from ?? null, to: input.to ?? null,
    branch: input.branch.kind === "absent" ? { kind: "absent" } : { kind: "explicit", value: input.branch.value ?? null },
  })).digest("hex");
}

export function storedAiRequestFingerprint(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>).requestFingerprint;
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}
