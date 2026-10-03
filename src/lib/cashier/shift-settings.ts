import { Prisma, type PrismaClient } from "@prisma/client";
import { writeAuditLog, type AuditRequestContext } from "@/lib/audit";
import { resolveBusinessAccess, hasBusinessCapability } from "@/lib/business-groups/business-access";
import { runClosingSerializableTransaction } from "@/lib/closing/shift-control";

export class CashierShiftSettingError extends Error {}
export const OPEN_SHIFTS_SETTING_MESSAGE = "End all open cashier shifts before turning Cashier shifts off.";

export function parseCashierShiftSetting(value: unknown): boolean {
  if (value !== "true" && value !== "false") throw new CashierShiftSettingError("Cashier shifts setting is invalid.");
  return value === "true";
}

// KEY SHARE conflicts with the toggle's explicit FOR UPDATE lock, but not with
// the non-key invoice-number UPDATE. SHARE would deadlock concurrent checkouts
// when both upgrade their Business row lock to allocate an invoice number.
export async function readCashierShiftSettings(tx: Prisma.TransactionClient, businessId: string) {
  await lockCashierShiftSetting(tx, businessId, "KEY SHARE");
  return tx.business.findUniqueOrThrow({where:{id:businessId},select:{cashierShiftsEnabled:true,timezone:true,businessDayCutoffTime:true}});
}

async function lockCashierShiftSetting(tx: Prisma.TransactionClient, businessId:string, mode:"KEY SHARE"|"UPDATE") {
  try {
    await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR ${Prisma.raw(mode)}`;
  } catch (error) {
    // Prisma exposes raw SELECT lock serialization failures as P2010/40001,
    // not P2034. Normalize only this lock so the existing bounded transaction
    // retry re-reads current mode; no financial/recovery retry framework.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2010" && error.meta?.code === "40001") {
      throw new Prisma.PrismaClientKnownRequestError(error.message,{code:"P2034",clientVersion:error.clientVersion});
    }
    throw error;
  }
}

export async function saveCashierShiftSetting(database: PrismaClient, input: {
  businessId: string; actor: {userId:string}; enabled: unknown; request?: AuditRequestContext;
}) {
  if (typeof input.enabled !== "boolean") throw new CashierShiftSettingError("Cashier shifts setting is invalid.");
  const enabled = input.enabled;
  return runClosingSerializableTransaction(database, async tx => {
    const access = await resolveBusinessAccess({userId:input.actor.userId,requestedBusinessId:input.businessId,capability:"MODIFY_BUSINESS_SETTINGS"},tx);
    if (!access.granted || access.businessId !== input.businessId || !hasBusinessCapability(access,"MODIFY_BUSINESS_SETTINGS")) {
      throw new CashierShiftSettingError("Business settings access denied.");
    }
    await lockCashierShiftSetting(tx,input.businessId,"UPDATE");
    const business = await tx.business.findUniqueOrThrow({where:{id:input.businessId},select:{cashierShiftsEnabled:true}});
    if (business.cashierShiftsEnabled === enabled) return {changed:false,enabled};
    if (!enabled && await tx.cashierShift.count({where:{businessId:input.businessId,status:"OPEN"}}) > 0) {
      throw new CashierShiftSettingError(OPEN_SHIFTS_SETTING_MESSAGE);
    }
    const actor = await tx.user.findUniqueOrThrow({where:{id:input.actor.userId},select:{name:true,email:true}});
    await tx.business.update({where:{id:input.businessId},data:{cashierShiftsEnabled:enabled}});
    await writeAuditLog({businessId:input.businessId,actor:{userId:input.actor.userId,name:actor.name,email:actor.email ?? ""},action:"CASHIER_SHIFTS_SETTING_CHANGED",entityType:"Business",entityId:input.businessId,summary:`Cashier shifts ${enabled ? "enabled" : "disabled"}.`,before:{cashierShiftsEnabled:business.cashierShiftsEnabled},after:{cashierShiftsEnabled:enabled},request:input.request},tx);
    return {changed:true,enabled};
  });
}
