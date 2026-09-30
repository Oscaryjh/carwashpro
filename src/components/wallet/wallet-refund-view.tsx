import type {RefundIntentRequest} from "@/lib/wallet/refund-intent";
export function hasWalletInvoiceSource(invoice:{hasWalletPayment?:boolean;walletPaidAmount?:number;refundablePayments?:{method:string}[]}){
 return invoice.hasWalletPayment===true||(invoice.walletPaidAmount??0)>0||!!invoice.refundablePayments?.some(payment=>payment.method==="MEMBER_WALLET");
}
export type RefundOptions={kind:string;legs:{paymentId:string;method:string;availableCents:number}[];stockLines:{id:string;name:string;remainingQuantity:number}[];paidAmount:string;bonusAmount:string;method:string;canVoid:boolean};
export function WalletRefundFields({options}:{options:RefundOptions}){
 return <>
  {options.kind==="top-up"?<p>Return RM {options.paidAmount} via {options.method}. Remove bonus RM {options.bonusAmount}. This records the original-channel refund; it does not send money.</p>:options.legs.filter(l=>l.availableCents>0).map(l=><fieldset key={l.paymentId}>
   <legend>{l.method==="MEMBER_WALLET"?"Return to member wallet":`${l.method} payment`}</legend>
   <label>Refund amount (RM)<input name={`amount_${l.paymentId}`} type="number" step="0.01" min="0" max={(l.availableCents/100).toFixed(2)} defaultValue="0"/></label>
   <small>Available: RM {(l.availableCents/100).toFixed(2)}</small>
   {l.method==="MEMBER_WALLET"?<input type="hidden" name={`method_${l.paymentId}`} value="MEMBER_WALLET"/>:<label>Refund method<select name={`method_${l.paymentId}`} defaultValue={l.method}>{["CASH","CARD","DUITNOW","EWALLET","BANK_TRANSFER"].map(m=><option key={m} value={m}>{m}</option>)}</select></label>}
   {l.method!=="MEMBER_WALLET"?<label>External refund reference<input name={`reference_${l.paymentId}`}/></label>:null}
  </fieldset>)}
  {options.stockLines.map(i=><fieldset key={i.id}><legend>{i.name}</legend><label>Returned quantity<input name={`quantity_${i.id}`} type="number" min="0" max={i.remainingQuantity} step="1" defaultValue="0"/></label><label>Stock treatment<select name={`disposition_${i.id}`}><option value="RESTOCK">Restock</option><option value="NO_RESTOCK">Do not restock</option></select></label><label>No-restock reason<input name={`stockReason_${i.id}`}/></label></fieldset>)}
  {options.kind==="top-up"?<label>Original-channel refund reference<input name="externalRefundReference" required={options.method!=="CASH"}/></label>:null}
  <label>Reason<textarea name="reason" minLength={3} maxLength={500} required/></label>
 </>;
}
const refundMethodLabels:Record<string,string>={MEMBER_WALLET:"Member wallet",CASH:"Cash",CARD:"Card",DUITNOW:"DuitNow",EWALLET:"E-wallet",BANK_TRANSFER:"Bank transfer"};
type DisplayLeg={method:string;amountCents:number;reference?:string};
// Display only: never normalize, replace, or persist the original retry payload.
function pendingLegs(raw:string|undefined):DisplayLeg[]|null{
 try{
  const legs:unknown=JSON.parse(raw??"[]");
  if(!Array.isArray(legs)||!legs.length||legs.some(l=>!l||typeof l.method!=="string"||!Object.hasOwn(refundMethodLabels,l.method)||!Number.isSafeInteger(l.amountCents)||l.amountCents<=0||(l.reference!==undefined&&typeof l.reference!=="string")))return null;
  if(!Number.isSafeInteger(legs.reduce((sum,l)=>sum+l.amountCents,0)))return null;
  return legs;
 }catch{return null;}
}
export function WalletRefundPending({request,invoiceNumber}:{request:RefundIntentRequest;invoiceNumber?:string}){
 const legs=request.fields.kind==="refund"?pendingLegs(request.fields.legs):null;
 const money=(cents:number)=>`RM${(cents/100).toFixed(2)}`;
 const row=(label:string,value:string,key=label)=><div key={key} style={{display:"grid",gridTemplateColumns:"minmax(9rem, auto) 1fr",gap:"1rem",padding:"0.35rem 0"}}><dt>{label}</dt><dd style={{margin:0,overflowWrap:"anywhere"}}>{value}</dd></div>;
 return <section aria-label="Saved refund confirmation">
  <strong>Refund confirmation pending</strong>
  <p>Your refund may have been completed.<br/>Do not issue another refund.</p>
  <h4>{request.fields.kind==="reversal"?"Original top-up reversal":request.fields.kind==="void"?"Original invoice void":"Original refund"}</h4>
  <dl>
   {invoiceNumber?row("Invoice",invoiceNumber.startsWith("#")?invoiceNumber:`#${invoiceNumber}`):null}
   {legs?.map((leg,index)=>row(refundMethodLabels[leg.method],money(leg.amountCents),`leg-${index}`))}
   {legs?row("Total refund",money(legs.reduce((sum,leg)=>sum+leg.amountCents,0))):null}
   {legs?.filter(leg=>!!leg.reference).map((leg,index)=>row(`${refundMethodLabels[leg.method]} reference`,leg.reference!,`reference-${index}`))}
   {request.fields.externalRefundReference?row("Reference",request.fields.externalRefundReference):null}
   {row("Reason",request.fields.reason??"")}
  </dl>
  {!legs?<p>The original confirmation is retained. Retry to confirm its result; do not create another refund.</p>:null}
 </section>;
}
