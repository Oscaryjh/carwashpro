"use client";
import {useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {walletRefundOptionsAction,reverseWalletTopUpAction} from "@/app/(business)/crm/wallet/actions";
import {refundWalletSaleAction,voidInvoiceAction} from "@/app/(business)/invoices/actions";
import {findSavedRefundIntent,WalletRefundIntent,validateRefundIntentFields,type RefundIntentRequest} from "@/lib/wallet/refund-intent";
import {WalletRefundFields,WalletRefundPending} from "./wallet-refund-view";
type Options=Extract<Awaited<ReturnType<typeof walletRefundOptionsAction>>,{ok:true}>["data"];
export function WalletRefundForm({sourceId,kind="invoice",recoveryScope,onSuccess,recoveryOnly=false,invoiceNumber}:{sourceId:string;kind?:"invoice"|"top-up";recoveryScope?:string;onSuccess?:()=>void;recoveryOnly?:boolean;invoiceNumber?:string}){
 const router=useRouter(),intent=useRef<WalletRefundIntent|null>(null);
 const [options,setOptions]=useState<Options|null>(null),[saved,setSaved]=useState<RefundIntentRequest|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[done,setDone]=useState(false);
 useEffect(()=>{let live=true;intent.current=null;setOptions(null);setSaved(null);setDone(false);
  try {
   const entries=Array.from({length:sessionStorage.length},(_,index)=>sessionStorage.key(index)).filter((key):key is string=>!!key&&key.startsWith("wallet-refund:")).flatMap(key=>{const value=sessionStorage.getItem(key);return value===null?[]:[[key,value] as const];});
   if(recoveryScope)setSaved(findSavedRefundIntent(entries,sourceId,kind,recoveryScope));
  } catch { setMessage("Saved refund confirmation could not be read. Do not refund again; ask the owner to review this source."); }
  void walletRefundOptionsAction(sourceId,kind).then(result=>{if(!live)return;if(!result.ok){setMessage(result.message);return;}const key=`wallet-refund:${result.data.scope}`;
   intent.current=new WalletRefundIntent(result.data.scope,{read:()=>sessionStorage.getItem(key),write:value=>sessionStorage.setItem(key,value),remove:()=>sessionStorage.removeItem(key)});
   setSaved(intent.current.existing);setOptions(result.data);setMessage("");
  }).catch(()=>{if(live)setMessage("Refund controls unavailable. Do not refund again if a confirmation is pending.");});return()=>{live=false;};
 },[sourceId,kind,recoveryScope]);
 async function submit(form:HTMLFormElement,mode:string){
  if(!options||!options.releaseEnabled||!intent.current||busy||done||(!saved&&options.packagePurchaseRefund?.unavailableReason))return;
  try{
   const data=new FormData(form),legs=options.legs.flatMap(l=>{const amount=Number(data.get(`amount_${l.paymentId}`)??0);if(!Number.isFinite(amount)||Math.abs(amount*100-Math.round(amount*100))>0.0001)throw new Error("Use up to two decimal places.");return amount>0?[{paymentId:l.paymentId,amountCents:Math.round(amount*100),method:String(data.get(`method_${l.paymentId}`)),reference:String(data.get(`reference_${l.paymentId}`)??"")}]:[];});
   const fields={kind:mode,businessId:options.businessId,sourceId,reason:String(data.get("reason")??""),legs:JSON.stringify(legs),stockLines:JSON.stringify(options.stockLines.flatMap(i=>{const quantity=Number(data.get(`quantity_${i.id}`)??0);return quantity>0?[{invoiceItemId:i.id,quantity,disposition:String(data.get(`disposition_${i.id}`)),noRestockReason:String(data.get(`stockReason_${i.id}`)??"")}]:[];})),externalRefundReference:String(data.get("externalRefundReference")??"")};
   if(!saved){validateRefundIntentFields(fields);if(mode==="refund"&&options.stockLines.length&&!JSON.parse(fields.stockLines).length)throw new Error("Choose returned quantities and stock treatment.");if(!window.confirm("Confirm these refund details? Do not send or return money a second time when retrying."))return;}
   const request=intent.current.begin(fields);if(!request)return;setSaved(request);setBusy(true);
   const payload=new FormData();Object.entries(request.fields).forEach(([key,value])=>payload.set(key,value));payload.set("operationKey",request.operationKey);payload.set("operationId",request.operationKey);payload.set("invoiceId",request.fields.sourceId);payload.set("topUpId",request.fields.sourceId);payload.set("voidReason",request.fields.reason);
   const result=request.fields.kind==="reversal"?await reverseWalletTopUpAction(payload):request.fields.kind==="void"?await voidInvoiceAction({status:"idle",message:""},payload):await refundWalletSaleAction({status:"idle",message:""},payload);
   const success="ok" in result?result.ok:result.status==="success";
   if(success){intent.current.completed();setSaved(null);setDone(true);setMessage("Completed. Do not repeat this refund.");router.refresh();onSuccess?.();}
   else{if("canCorrect" in result&&result.canCorrect&&intent.current.rejected())setSaved(null);else intent.current.uncertain();setMessage("message" in result?(result.message??"Result unknown. Retry the same confirmation."):"Result unknown. Retry the same confirmation.");}
  }catch(error){if(intent.current?.existing)intent.current.uncertain();setMessage(error instanceof Error?error.message:"Result unknown. Retry the same confirmation; do not refund again.");}finally{setBusy(false);}
 }
 if(!saved&&(!options?.releaseEnabled||recoveryOnly))return null;
 return <section className="wallet-ui"><h3>{kind==="top-up"?"Reverse unused top-up":"Wallet sale refund"}</h3>
  {message?<p role="status">{message}</p>:null}
  {saved&&!options?<WalletRefundPending request={saved} invoiceNumber={invoiceNumber}/>:null}
  {options&&!done?<form onSubmit={e=>{e.preventDefault();void submit(e.currentTarget,kind==="top-up"?"reversal":"refund");}}>
   {saved?<WalletRefundPending request={saved} invoiceNumber={invoiceNumber}/>:options.reversed?<p>This source is already reversed.</p>:<WalletRefundFields options={options}/>}
   {!options.releaseEnabled?<p>Wallet actions are unavailable. Your saved confirmation is retained. Do not refund again.</p>:null}
   {!options.reversed||saved?<button type="submit" disabled={busy||!options.releaseEnabled||(!saved&&!!options.packagePurchaseRefund?.unavailableReason)}>{busy?"Processing…":saved?"Retry confirmation":kind==="top-up"?"Reverse top-up":options.packagePurchaseRefund?"Process full refund":"Confirm refund"}</button>:null}
   {!saved&&options.canVoid?<button type="button" className="secondary" disabled={busy} onClick={e=>{const form=e.currentTarget.form;if(form?.reportValidity())void submit(form,"void");}}>Void invoice</button>:null}
  </form>:null}
 </section>;
}
