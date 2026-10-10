import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

export async function reportFixture(db: PrismaClient, count = 1) {
  const token = randomUUID();
  const business = await db.business.create({data:{name:`PHASE1C1 ${count} active`,slug:`phase1c1-${token}`,industryType:"SALON_BEAUTY",timezone:"Asia/Singapore",businessDayCutoffTime:"02:00"}});
  const branches = [];
  for (let i=0;i<count;i++) branches.push(await db.branch.create({data:{businessId:business.id,name:`Current ${i+1}`}}));
  const historical = await db.branch.create({data:{businessId:business.id,name:"Historical inactive",status:"INACTIVE"}});
  const owner = await db.user.create({data:{businessId:business.id,branchId:branches[0]?.id,name:"Synthetic Owner",email:`report-owner-${token}@example.test`,role:"BUSINESS_OWNER"}});
  const staff = await db.user.create({data:{businessId:business.id,branchId:branches[0]?.id,name:"Synthetic Staff",email:`report-staff-${token}@example.test`,role:"STAFF",permissions:["DASHBOARD","REPORTS","PERFORMANCE_VIEW_TEAM"]}});
  await db.businessModuleEntitlement.createMany({data:["POS","SALON","INVENTORY","EXPENSE"].map(moduleKey=>({businessId:business.id,moduleKey:moduleKey as "POS",status:"ENABLED",source:"MANUAL",enabledFrom:new Date(0)}))});
  const customer=await db.customer.create({data:{businessId:business.id,name:"Synthetic customer",phone:token}});
  const category=await db.expenseCategory.create({data:{businessId:business.id,name:"Synthetic operations",code:`OPS-${token}`}});
  for (const [branch,amount] of [[branches[0],1000],[historical,500]] as const) {
    if (!branch) continue;
    const at=new Date("2026-10-10T04:00:00Z");
    const appointment=await db.appointment.create({data:{businessId:business.id,branchId:branch.id,customerId:customer.id,scheduledAt:at,status:"COMPLETED",assignedStaffId:staff.id}});
    const invoice=await db.invoice.create({data:{businessId:business.id,branchId:branch.id,appointmentId:appointment.id,invoiceNumber:`INV-${branch.id}`,subtotal:amount,total:amount,paidAmount:amount,balance:0,status:"PAID",issuedAt:at}});
    await db.payment.create({data:{businessId:business.id,branchId:branch.id,invoiceId:invoice.id,amount,method:"CASH",status:"ACTIVE",paidAt:at,cashierId:owner.id}});
    await db.businessExpense.create({data:{businessId:business.id,branchId:branch.id,expenseNumber:`EXP-${branch.id.slice(0,20)}`,categoryId:category.id,categoryNameSnapshot:category.name,branchNameSnapshot:branch.name,expenseDate:at,amount:20,description:"Synthetic branch expense",status:"CONFIRMED",paymentStatus:"UNPAID",createdById:owner.id,confirmedById:owner.id,confirmedAt:at}});
  }
  await db.businessExpense.create({data:{businessId:business.id,expenseNumber:`EXP-BUSINESS-${token.slice(0,16)}`,categoryId:category.id,categoryNameSnapshot:category.name,expenseDate:new Date("2026-10-10T04:00:00Z"),amount:30,description:"Synthetic business-wide expense",status:"CONFIRMED",paymentStatus:"UNPAID",createdById:owner.id,confirmedById:owner.id,confirmedAt:new Date()}});
  const product=await db.product.create({data:{businessId:business.id,name:"Synthetic tracked product",price:25,trackInventory:true,stocks:{create:[...(branches[0]?[{branchId:branches[0].id,quantity:12,reorderLevel:2}]:[]),{branchId:historical.id,quantity:99,reorderLevel:2}]}}});
  await db.product.create({data:{businessId:business.id,name:"Historical-only tracked catalog item",price:10,trackInventory:true,stocks:{create:{branchId:historical.id,quantity:5}}}});
  return {business,branches,historical,owner,staff,customer,product};
}
