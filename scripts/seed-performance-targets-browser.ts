import { PrismaClient } from "@prisma/client";
import { capturePerformanceCheckout,capturePerformanceRefund } from "../src/lib/performance/service";
async function main(){
 const url=new URL(process.env.DATABASE_URL??"http://invalid");if(!["localhost","127.0.0.1"].includes(url.hostname)||!/^\/tetamu_performance_disposable_[a-z0-9_]+$/.test(url.pathname))throw new Error("Explicit disposable local database required");
 process.env.TETAMU_PERFORMANCE_PHASE1="true";const db=new PrismaClient();
 try{const b=await db.business.findUniqueOrThrow({where:{slug:"performance-browser-salon"}}),branch=await db.branch.findFirstOrThrow({where:{businessId:b.id}}),owner=await db.user.findFirstOrThrow({where:{businessId:b.id,role:"BUSINESS_OWNER"}});
 if(await db.invoice.count({where:{businessId:b.id,invoiceNumber:{startsWith:"P2-UI-"}}}))throw new Error("Refusing to overwrite existing UI fixtures");
 const members=await db.employeeBusinessMembership.findMany({where:{businessId:b.id},orderBy:{employeeCode:"asc"}});
 for(let i=0;i<28;i++)await db.$transaction(async tx=>{
  const total=i===0?600000:118;const at=new Date(`2026-08-${String(i%27+1).padStart(2,"0")}T04:00Z`);
  const inv=await tx.invoice.create({data:{businessId:b.id,branchId:branch.id,invoiceNumber:`P2-UI-${i+1}`,subtotal:i===0?total:100,taxAmount:i===0?0:8,tipAmount:i===0?0:10,total,paidAmount:total,balance:0,status:"PAID"}});
  const p=await tx.payment.create({data:{businessId:b.id,branchId:branch.id,invoiceId:inv.id,amount:total,method:"CASH",paidAt:at}});
  await capturePerformanceCheckout(tx,{businessId:b.id,actorUserId:owner.id,paymentIds:[p.id],input:{version:1,sales:[{membershipId:members[0].id,basisPoints:5000},{membershipId:members[1].id,basisPoints:5000}],tipMembershipId:i===0?null:members[2].id}});
  if(i===1){const refund=await tx.paymentRefund.create({data:{businessId:b.id,branchId:branch.id,invoiceId:inv.id,paymentId:p.id,amount:59,method:"CASH",reason:"Isolated UI partial refund",refundedAt:new Date("2026-08-28T04:00Z")}});await capturePerformanceRefund(tx,refund.id,{businessId:b.id,actorUserId:owner.id});}
 });
 await db.user.create({data:{businessId:b.id,branchId:branch.id,name:"Performance read only",email:"phase2-reader@tetamu.test",passwordHash:owner.passwordHash,role:"STAFF",permissions:["PERFORMANCE_VIEW_TEAM"]}});
 await db.branch.create({data:{businessId:b.id,name:"Empty performance branch"}});
 console.log(JSON.stringify({branchId:branch.id,ownerEmail:owner.email,members:members.slice(0,7).map(m=>({id:m.id,code:m.employeeCode})),expectedNetCents:60291500}));
 }finally{await db.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
