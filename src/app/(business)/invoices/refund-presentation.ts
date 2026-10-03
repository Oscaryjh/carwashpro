"use server";

import {z} from "zod";
import {requireBusinessUser} from "@/lib/auth/business-user";
import {authorizedOperationalBranchWhere} from "@/lib/branches";
import {prisma} from "@/lib/prisma";
import {getRefundableCents} from "@/lib/refunds/rules";
import {packageRefundPresentation} from "@/lib/refunds/package-presentation";
import {toCents} from "@/lib/validation/pos";

/** Read-only UI metadata. The existing refund action remains authoritative. */
export async function refundPresentationAction(invoiceId: string, paymentId: string) {
  const {businessId,user}=await requireBusinessUser("PROCESS_REFUND");
  try {
    if(user.role!=="BUSINESS_OWNER")throw new Error("Only the business owner can process refunds.");
    z.string().uuid().parse(invoiceId);z.string().uuid().parse(paymentId);
    const invoice=await prisma.invoice.findFirst({
      where:{id:invoiceId,businessId,...authorizedOperationalBranchWhere(user)},
      include:{customerPackage:{include:{serviceBalances:true}},items:{include:{customerPackage:{include:{serviceBalances:true}}}},payments:{select:{method:true,customerPackageId:true}}},
    });
    if(!invoice)throw new Error("Invoice not found.");
    const payment=await prisma.payment.findFirst({
      where:{id:paymentId,businessId,status:"ACTIVE",OR:[{invoiceId:invoice.id},...(invoice.workOrderId?[{workOrderId:invoice.workOrderId}]:[])]},
      include:{refunds:true},
    });
    if(!payment)throw new Error("Active payment not found for this invoice.");
    const refundableCents=getRefundableCents(toCents(payment.amount),payment.refunds.map(r=>toCents(r.amount)));
    const packagePurchaseRefund=payment.method==="PACKAGE"?null:packageRefundPresentation(invoice,refundableCents);
    if(packagePurchaseRefund&&invoice.status==="VOID")packagePurchaseRefund.unavailableReason="A void invoice cannot be refunded.";
    return {ok:true as const,refundableAmount:refundableCents/100,packagePurchaseRefund};
  } catch(error) {
    return {ok:false as const,message:error instanceof Error?error.message:"Refund details could not be loaded."};
  }
}
