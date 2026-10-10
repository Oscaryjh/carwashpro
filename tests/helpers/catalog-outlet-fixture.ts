import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createSessionToken, persistSessionContext } from "../../src/lib/auth/session";

export async function catalogFixture(db: PrismaClient, count=1) {
  const business=await db.business.create({data:{name:`PHASE1B2 ${count} active`,slug:`phase1b2-${randomUUID()}`,industryType:"SALON_BEAUTY",cashierShiftsEnabled:false}});
  await db.businessModuleEntitlement.createMany({data:["POS","SALON"].map(moduleKey=>({businessId:business.id,moduleKey:moduleKey as "POS",status:"ENABLED",source:"MANUAL",enabledFrom:new Date(0)}))});
  const branches=[];
  for(let i=0;i<count;i++) branches.push(await db.branch.create({data:{businessId:business.id,name:`Active ${i+1}`}}));
  const historical=await db.branch.create({data:{businessId:business.id,name:"Historical inactive",status:"INACTIVE"}});
  const owner=await db.user.create({data:{businessId:business.id,branchId:branches[0]?.id,name:"Synthetic Owner",role:"BUSINESS_OWNER",email:`owner-${randomUUID()}@example.test`,appointmentBookable:true}});
  const staff=await db.user.create({data:{businessId:business.id,branchId:branches[0]?.id,name:"Synthetic Staff",role:"STAFF",email:`staff-${randomUUID()}@example.test`,permissions:["SERVICES","PACKAGES","POS","APPOINTMENTS"]}});
  const noScope=await db.user.create({data:{businessId:business.id,name:"Synthetic no scope",role:"STAFF",email:`no-scope-${randomUUID()}@example.test`,permissions:["SERVICES","PACKAGES"]}});
  const category=await db.serviceCategory.create({data:{businessId:business.id,name:"Synthetic services"}});
  const packageCategory=await db.packageCategory.create({data:{businessId:business.id,name:"Synthetic packages"}});
  const services=[],packages=[];
  for(const [name,branchId] of [["Null",null],["Current",branches[0]?.id??null],["Historical",historical.id]] as const) {
    services.push(await db.service.create({data:{businessId:business.id,branchId,categoryId:category.id,category:category.name,name:`${name} service`,price:25,durationMinutes:30}}));
    packages.push(await db.package.create({data:{businessId:business.id,branchId,categoryId:packageCategory.id,name:`${name} package`,price:100,totalUses:5,serviceBenefits:{create:{businessId:business.id,serviceId:services[0].id,totalUses:5}}}}));
  }
  const customer=await db.customer.create({data:{businessId:business.id,name:"Synthetic customer",phone:randomUUID()}});
  const customerPackage=await db.customerPackage.create({data:{businessId:business.id,customerId:customer.id,packageId:packages[0].id,branchId:null,totalUses:5,remainingUses:5,purchasePrice:100}});
  return {business,branches,historical,owner,staff,noScope,category,packageCategory,services,packages,customer,customerPackage};
}

export async function loginCatalogFixture(db:PrismaClient,f:Awaited<ReturnType<typeof catalogFixture>>,actor=f.owner) {
  const session={userId:actor.id,sessionId:randomUUID(),homeBusinessId:f.business.id,activeBusinessId:f.business.id,contextVersion:1,branchId:actor.branchId,name:actor.name,email:actor.email!,role:actor.role,permissions:actor.permissions,status:actor.status};
  const stored=await persistSessionContext(session,{database:db});
  Object.assign(globalThis,{catalogOutletPageCookie:await createSessionToken(session,{absoluteExpiresAt:stored.absoluteExpiresAt})});
}

export function catalogForm(f:Awaited<ReturnType<typeof catalogFixture>>,kind:"Service"|"Package",index=0) {
  const form=new FormData();
  for(const [key,value] of Object.entries({name:`Edited ${kind} ${randomUUID()}`,price:"40",description:"Synthetic edit",categoryId:kind==="Service"?f.category.id:f.packageCategory.id,status:"ACTIVE",durationMinutes:"30",totalUses:"5",serviceBenefits:JSON.stringify([{serviceId:f.services[0].id,totalUses:5}]),[kind==="Service"?"serviceId":"packageId"]:(kind==="Service"?f.services:f.packages)[index].id})) form.set(key,value);
  if(kind==="Package") {form.set("benefitServiceId",f.services[0].id);form.set("benefitTotalUses","5");}
  return form;
}
