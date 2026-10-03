"use server";

import { revalidatePath } from "next/cache";
import { getAuditRequestContext } from "@/lib/audit";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { prisma } from "@/lib/prisma";
import { CashierShiftSettingError, parseCashierShiftSetting, saveCashierShiftSetting } from "@/lib/cashier/shift-settings";

export type CashierOperationsState = {status:"idle"|"success"|"error";message:string};

export async function saveCashierOperationsAction(_previous:CashierOperationsState, formData:FormData):Promise<CashierOperationsState> {
  const context=await requireBusinessUser("MODIFY_BUSINESS_SETTINGS");
  try {
    // Business comes exclusively from the authenticated context, never the form.
    const result=await saveCashierShiftSetting(prisma,{businessId:context.businessId,actor:context.user,enabled:parseCashierShiftSetting(formData.get("cashierShiftsEnabled")),request:await getAuditRequestContext()});
    revalidatePath("/business/settings");
    revalidatePath("/closing");
    revalidatePath("/cashier");
    return {status:"success",message:result.changed ? "Cashier operations saved." : "Cashier operations unchanged."};
  }catch(error){
    if(error instanceof CashierShiftSettingError) return {status:"error",message:error.message};
    throw error;
  }
}
