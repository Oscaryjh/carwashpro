import assert from "node:assert/strict";
import test from "node:test";
import { reportOutletPages } from "../helpers/report-outlet-pages";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

function setup(count=1) {
  Object.assign(globalThis,{reportPageModel:undefined});
  const business={id:"business",name:"Synthetic",status:"active",industryType:"SALON_BEAUTY",timezone:"Asia/Kuching",businessDayCutoffTime:"02:00"};
  const user={id:"owner",userId:"owner",businessId:"business",branchId:null,role:"BUSINESS_OWNER",permissions:[],status:"active",loginEnabled:true,business,branch:null};
  const access={granted:true,source:"DIRECT_BUSINESS",businessId:"business",effectiveBusinessRole:"BUSINESS_OWNER",permissions:[],branchId:null,industryType:"SALON_BEAUTY"};
  Object.assign(globalThis,{reportPageContext:{user,access,businessId:"business",industryType:"SALON_BEAUTY",isPlatformAdmin:false},reportPageDb:{
    user:{findUnique:async()=>user},business:{findUnique:async()=>business,findUniqueOrThrow:async()=>business},businessGroupUser:{findFirst:async()=>null},
    branch:{findMany:async(arg:{where:{status?:string}})=>[...Array.from({length:count},(_,i)=>({id:`branch-${i}`,name:`Store ${i}`})),...(!arg.where.status?[{id:"historical",name:"Old store"}]:[])]},
  }});
}
test("Performance default current scope does not ask Owner to choose an inactive historical branch",async()=>{
  setup();process.env.TETAMU_PERFORMANCE_PHASE2="true";const pages=await reportOutletPages();
  await assert.rejects(pages.Performance({searchParams:Promise.resolve({})}),(error:unknown)=>{const e=error as Error&{input:{branchId:string}};assert.equal(e.message,"PERFORMANCE_READER");assert.equal(e.input.branchId,"branch-0");return true;});
});
test("single dashboard hides location UX and keeps auto-scoped period links free of explicit branch intent",async()=>{
  setup();Object.assign(globalThis,{reportPageModel:{scope:{businessName:"Synthetic"},dateRange:{from:"2026-10-10",to:"2026-10-10",timezone:"Asia/Kuching",businessDayCutoffTime:"02:00",range:"today"},businessSpending:null,sales:null,inventory:null,accountsPayable:null,walletActivity:null,salonPerformance:null,topServices:[],topProducts:[],branchPerformance:[],coverage:{},reconciliationHealth:{status:"HEALTHY"}}});
  const pages=await reportOutletPages();const html=renderToStaticMarkup(await pages.Dashboard({searchParams:Promise.resolve({})}) as ReactNode);
  assert.doesNotMatch(html,/>Branch<|name="branchId"|All authorised branches/);
  assert.match(html,/href="\/dashboard\?range=month"/);
});
for(const page of ["Dashboard","Reports"] as const) {
  test(`${page} passes a server-resolved single branch to its current reader`,async()=>{
    setup();const pages=await reportOutletPages();
    await assert.rejects(pages[page]({searchParams:Promise.resolve({})}), (error:unknown)=>{
      const e=error as Error&{input:Record<string,unknown>}; assert.equal(e.message,"READER");
      assert.equal(e.input[page==="Dashboard"?"selectedBranchId":"branchId"],"branch-0");
      if(page==="Dashboard") {assert.deepEqual(e.input.expenseScope,{allowedBranchIds:["branch-0"],includeBusinessWide:true});assert.equal((e.input.salonAccess as {requestedBranchId:string}).requestedBranchId,"branch-0");}
      return true;
    });
  });
  test(`${page} rejects invalid explicit branch before running report queries`,async()=>{
    setup();const pages=await reportOutletPages();await assert.rejects(pages[page]({searchParams:Promise.resolve({branchId:"foreign"})}),/NOT_FOUND/);
  });
}
