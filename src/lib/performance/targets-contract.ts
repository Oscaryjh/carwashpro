import { z } from "zod";

export const targetMoney = z.number().int().min(0).max(1_000_000_000_000);
export const targetDraftSchema = z.object({
  year: z.number().int().min(2000).max(2200),
  levels: z.tuple([targetMoney, targetMoney, targetMoney]),
  managerId: z.string().uuid().nullable(),
  people: z.array(z.object({ membershipId: z.string().uuid(), amount: targetMoney }).strict()).max(1000),
  expectedRevision: z.number().int().min(0),
  reason: z.string().trim().min(5).max(500),
  confirmGap: z.boolean(),
}).strict().superRefine((d, ctx) => {
  if (!(d.levels[0] > 0 && d.levels[1] > d.levels[0] && d.levels[2] > d.levels[1])) ctx.addIssue({ code: "custom", message: "三级门槛必须大于零且严格递增。" });
  if (new Set(d.people.map(p => p.membershipId)).size !== d.people.length) ctx.addIssue({ code: "custom", message: "员工不能重复分配。" });
  if (d.managerId && !d.people.some(p => p.membershipId === d.managerId)) ctx.addIssue({ code: "custom", message: "店长必须包含在个人目标中。" });
});
export type TargetDraft = z.infer<typeof targetDraftSchema>;
export type TargetPerson = { membershipId: string; amount: number; fullName: string; employeeCode: string; status: string };
export type TargetSnapshot = { levels: [number, number, number]; managerId: string | null; people: TargetPerson[]; gap: number };
export const DEFAULT_LEVELS: [number, number, number] = [60_000_000, 80_000_000, 100_000_000];
export function targetGap(level: number, people: { amount: number }[]) { return level - people.reduce((sum, p) => sum + p.amount, 0); }
export function equalTargets(level: number, managerAmount: number, managerId: string, ids: string[]) {
  if (![level, managerAmount].every(v => Number.isSafeInteger(v) && v >= 0) || managerAmount > level) throw new Error("店长目标超过第一级，无法平均分配。");
  const others = [...new Set(ids)].filter(id => id !== managerId).sort();
  if (!managerId || !others.length) throw new Error("请选择店长及至少一名其他员工。");
  const remaining = level - managerAmount;
  return [{ membershipId: managerId, amount: managerAmount }, ...others.map((membershipId, index) => ({
    membershipId, amount: Math.floor(remaining / others.length) + (index < remaining % others.length ? 1 : 0),
  }))];
}
export function progress(amount: number, target: number | null, complete: boolean) {
  return { amount, target, percent: complete && target && target > 0 ? amount / target * 100 : null,
    gap: target && target > 0 ? target - amount : null, state: !target ? "NO_TARGET" : complete ? "CONFIRMED" : "INCOMPLETE" };
}
export function teamLevel(amount: number, levels: readonly number[] | null, complete: boolean) {
  if (!levels || !complete) return { level: null, nextGap: null };
  const level = levels.filter(v => amount >= v).length;
  return { level, nextGap: level === 3 ? 0 : Math.max(0, levels[level] - amount) };
}
export function comparePerformance(current: number, previous: number, complete: boolean) {
  return { delta: current - previous, percent: complete && previous > 0 ? (current - previous) / previous * 100 : null, complete };
}
export function parseTargetAmount(value: string) {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) throw new Error("请输入有效金额，最多两位小数。");
  const [whole, fraction = ""] = value.trim().split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
export const formatTargetMoney = (value: number | null) => value === null ? "待核对" : new Intl.NumberFormat("en-MY", { style: "currency", currency: "MYR" }).format(value / 100);
