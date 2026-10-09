import assert from "node:assert/strict";
import test from "node:test";
import {build} from "esbuild";
import {createRequire} from "node:module";
import {Prisma} from "@prisma/client";

// Replace only external database/auth/operation boundaries. Both consumers and
// the shared query execute unchanged; the fixture has no write methods.
test("options exposes consumed before submission and reversal rechecks the same query inside its transaction",async()=>{
 const reads:{inside:boolean;args:unknown}[]=[];
 let found:object|null=null,inside=false,authorized=false;
 const top={id:"10000000-0000-4000-8000-000000000001",businessId:"business",walletAccountId:"account",branchId:"branch",account:{customerId:"customer"},paidAmount:new Prisma.Decimal(1000),bonusAmount:new Prisma.Decimal(100),payment:{status:"ACTIVE",method:"CASH",refunds:[]},reversals:[],transactions:[{type:"TOP_UP_PAID",sequence:10},{type:"TOP_UP_BONUS",sequence:11}]};
 const db={walletTopUp:{findFirstOrThrow:async(args:{where:unknown})=>{assert.deepEqual(args.where,{id:top.id,businessId:"business"});return top;}},walletTransaction:{findFirst:async(args:unknown)=>{assert.equal(authorized,true);reads.push({inside,args});return found;}}};
 const fixture={db,authorize:()=>{authorized=true;return {};},operation:async(options:{execute:(client:typeof db)=>Promise<unknown>})=>{inside=true;try{return {result:await options.execute(db)};}finally{inside=false;}}};
 const modules:Record<string,string>={
  "@/lib/prisma":"export const prisma=fixture.db;",
  "@/lib/tenant":"export async function requireBusinessContext(){return {businessId:'business',user:{userId:'owner',name:'Owner'}};}",
  "@/lib/wallet/authorization":"export class WalletServiceError extends Error {}",
  "@/lib/wallet/refund-authorization":"export const readWalletRefundOwner=async()=>fixture.authorize();export const requireWalletRefundOwner=async()=>fixture.authorize();",
  "@/lib/wallet/release-policy":"export const assertWalletAccessAllowed=async()=>{};export const isWalletAccessAllowed=async()=>true;",
  "@/lib/wallet/ui-adapter":"export const getWalletPanel=()=>{},getWalletTopUpOptions=()=>{},getWalletHistory=()=>{},listWalletOffers=()=>{},saveWalletOffer=()=>{},submitWalletTopUp=()=>{};",
  "@/lib/financial-idempotency":"import {z} from 'zod';export const financialOperationKeySchema=z.string();export const runFinancialOperation=options=>fixture.operation(options);",
  "@/lib/audit":"export const writeAuditLog=()=>{throw Error('Unexpected write');};",
  "next/navigation":"export const unstable_rethrow=()=>{};",
 };
 const bundle=await build({stdin:{contents:`export {walletRefundOptionsAction} from './src/app/(business)/crm/wallet/actions';export {reverseWalletTopUp} from './src/lib/wallet/reversals';`,resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,platform:"node",format:"cjs",packages:"external",plugins:[{name:"readonly-boundaries",setup(b){
  b.onResolve({filter:/.*/},a=>modules[a.path]?{path:a.path,namespace:"fixture"}:a.path==="./refund-authorization"?{path:"@/lib/wallet/refund-authorization",namespace:"fixture"}:undefined);
  b.onLoad({filter:/.*/,namespace:"fixture"},a=>({contents:modules[a.path],loader:"ts",resolveDir:process.cwd()}));
 }}]});
 const bundled={exports:{} as Pick<typeof import("../../src/app/(business)/crm/wallet/actions"),"walletRefundOptionsAction"> & Pick<typeof import("../../src/lib/wallet/reversals"),"reverseWalletTopUp">};new Function("require","module","exports","fixture",bundle.outputFiles[0].text)(createRequire(import.meta.url),bundled,bundled.exports,fixture);
 const {walletRefundOptionsAction,reverseWalletTopUp}=bundled.exports;
 for(const item of [null,{type:"REDEMPTION"},{paidDelta:-1},{bonusDelta:-1}]){
  found=item;authorized=false;reads.length=0;
  const result=await walletRefundOptionsAction(top.id,"top-up");
  assert.equal(result.ok,true);assert.ok("consumed" in result.data);assert.equal(result.data.consumed,item!==null);assert.equal(result.data.unavailableReason,null);
  assert.deepEqual(reads,[{inside:false,args:{where:{walletAccountId:"account",sequence:{gt:11},OR:[{type:"REDEMPTION"},{paidDelta:{lt:0}},{bonusDelta:{lt:0}}]}}}]);
  if(item){
   reads.length=0;
   await assert.rejects(()=>reverseWalletTopUp({businessId:"business",user:{userId:"owner"},branchId:"branch",shiftId:null}, {topUpId:top.id,operationKey:"original-key",reason:"Approved reversal",externalRefundReference:""},db as unknown as Parameters<typeof reverseWalletTopUp>[2]),(e:unknown)=>typeof e==="object"&&e!==null&&"code" in e&&e.code==="TOP_UP_ALREADY_CONSUMED");
   assert.equal(reads[0].inside,true,"authoritative guard must run again inside financial transaction");
  }
 }
 top.transactions=[];found=null;
 const invalid=await walletRefundOptionsAction(top.id,"top-up");
 assert.equal(invalid.ok,true);assert.ok("unavailableReason" in invalid.data);
 assert.equal(invalid.data.unavailableReason,"Incomplete original top-up ledger.");
});
