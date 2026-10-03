import type { Prisma } from "@prisma/client";
import { resolveBusinessAccess } from "@/lib/business-groups/business-access";
import type { BusinessCapability } from "@/lib/business-groups/capabilities";
import { canAccessOperationalBranch } from "@/lib/branches";
import { getCurrentBusinessDateValue } from "@/lib/business-day";
import { assertCashierShiftAcceptsActivity } from "@/lib/closing/shift-control";
import { readCashierShiftSettings } from "./shift-settings";

export class CashierShiftsDisabledError extends Error {
  constructor() { super("Cashier shifts are disabled for this business."); }
}

export class CashierShiftModeChangedError extends Error {
  readonly code = "CASHIER_SHIFT_MODE_CHANGED";
  constructor() { super("CASHIER_SHIFT_MODE_CHANGED: Cashier settings or your shift changed. Review and explicitly confirm again."); }
}

// This is only activity context, not permission to charge. Commands keep their
// own capability, module and financial-operation guards.
export async function resolveCashierActivityContext(tx: Prisma.TransactionClient, input: {
  businessId: string; branchId: string; actor: {userId:string}; activityAt?: Date;
  confirmation?: { modeAtConfirmation: unknown; shiftId: unknown };
  capability?: BusinessCapability;
}) {
  const access = await resolveBusinessAccess({userId:input.actor.userId,requestedBusinessId:input.businessId,capability:input.capability ?? "PROCESS_CASHIER_PAYMENT"},tx);
  if (!access.granted || access.businessId !== input.businessId) throw Error("Cashier activity access denied.");
  const branch = await tx.branch.findFirst({where:{id:input.branchId,businessId:input.businessId,status:"ACTIVE"},select:{id:true}});
  if (!branch || !canAccessOperationalBranch({role:access.identityRole,branchId:access.branchId},input.branchId)) throw Error("Cashier activity branch denied.");
  const settings = await readCashierShiftSettings(tx,input.businessId);
  const confirmation = input.confirmation;
  if (confirmation && confirmation.modeAtConfirmation !== (settings.cashierShiftsEnabled ? "ON" : "OFF")) {
    throw new CashierShiftModeChangedError();
  }
  const activityAt=input.activityAt ?? new Date();
  const businessDate=getCurrentBusinessDateValue(activityAt,settings.timezone,settings.businessDayCutoffTime);
  if (!settings.cashierShiftsEnabled) {
    if (confirmation && confirmation.shiftId != null && confirmation.shiftId !== "") throw new CashierShiftModeChangedError();
    return {...settings,branchId:branch.id,businessDate,activityAt,shiftId:null};
  }
  const shifts=await tx.cashierShift.findMany({where:{businessId:input.businessId,cashierId:input.actor.userId,status:"OPEN"},select:{id:true,branchId:true,startedAt:true},take:2});
  const shift=shifts[0];
  if (confirmation && confirmation.shiftId !== shift?.id) {
    throw new CashierShiftModeChangedError();
  }
  if (shifts.length !== 1 || shift.branchId !== branch.id) throw Error("Start an open shift before continuing.");
  await assertCashierShiftAcceptsActivity(tx,{businessId:input.businessId,activityAt,shift});
  return {...settings,branchId:branch.id,businessDate,activityAt,shiftId:shift.id};
}
