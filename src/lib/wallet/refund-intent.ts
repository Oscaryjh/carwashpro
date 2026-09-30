export type RefundIntentRequest = { operationKey: string; fields: Record<string,string> };
export function findSavedRefundIntent(entries: readonly (readonly [string,string])[], sourceId: string, sourceKind: "invoice" | "top-up", expectedScope: string): RefundIntentRequest | null {
  const allowedKinds = sourceKind === "invoice" ? new Set(["refund", "void"]) : new Set(["reversal"]);
  for (const [, raw] of entries) {
    try {
      const value = JSON.parse(raw) as { scope?: string; request?: RefundIntentRequest };
      const request = value?.request;
      if (value.scope === expectedScope && request?.fields?.sourceId === sourceId && allowedKinds.has(request.fields.kind) &&
          typeof request.operationKey === "string" &&
          Object.values(request.fields).every(field => typeof field === "string")) {
        return structuredClone(request);
      }
    } catch {
      // A malformed unrelated storage entry must not prevent displaying other saved requests.
    }
  }
  return null;
}
/** Unknown outcomes are never discarded or recalculated from today's remaining amount. */
export class WalletRefundIntent {
  private request: RefundIntentRequest | null = null;
  private pending = false;
  private unknown = false;
  constructor(private readonly scope:string,private readonly storage:{read:()=>string|null;write:(value:string)=>void;remove:()=>void}) {
    const raw=storage.read();
    if(raw){const value=JSON.parse(raw);if(value.scope!==scope||!value.request||typeof value.request.operationKey!=="string"||!value.request.fields||Array.isArray(value.request.fields)||Object.values(value.request.fields).some(v=>typeof v!=="string"))throw new Error("Saved refund confirmation is invalid. Ask the owner to review it; do not refund again.");this.request=value.request;this.unknown=true;}
  }
  get existing(){return this.request?structuredClone(this.request):null;}
  begin(fields:Record<string,string>){
    if(this.pending)return null;
    if(!this.request){const request={operationKey:crypto.randomUUID(),fields:structuredClone(fields)};this.storage.write(JSON.stringify({scope:this.scope,request}));this.request=request;}
    this.pending=true;return this.existing;
  }
  uncertain(){this.pending=false;this.unknown=true;}
  rejected(){this.pending=false;if(this.unknown)return false;this.storage.remove();this.request=null;return true;}
  completed(){this.storage.remove();this.request=null;this.pending=false;this.unknown=false;}
}
export function validateRefundIntentFields(fields:Record<string,string>){
 if(fields.reason.trim().length<3||fields.reason.length>500)throw new Error("Enter a clear reason (3–500 characters).");
 if(fields.kind==="refund"){
  const legs=JSON.parse(fields.legs) as {amountCents:number;method:string;reference?:string}[];
  if(!legs.length||legs.some(l=>!Number.isSafeInteger(l.amountCents)||l.amountCents<=0))throw new Error("Enter a positive refund amount.");
  if(legs.some(l=>l.method!=="CASH"&&l.method!=="MEMBER_WALLET"&&!l.reference?.trim()))throw new Error("Enter a reference for each non-cash refund.");
  const lines=JSON.parse(fields.stockLines) as {quantity:number;disposition:string;noRestockReason?:string}[];
  if(lines.some(l=>!Number.isInteger(l.quantity)||l.quantity<=0))throw new Error("Enter whole returned quantities.");
  if(lines.some(l=>l.disposition==="NO_RESTOCK"&&(!l.noRestockReason||l.noRestockReason.trim().length<3)))throw new Error("Enter a clear no-restock reason.");
 }
}
