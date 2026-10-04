"use client";

import {useCallback,useEffect,useState,type ComponentProps} from "react";
import {refundPresentationAction} from "@/app/(business)/invoices/refund-presentation";
import {RefundPaymentForm} from "./refund-payment-form";

/** Refresh read-only balances after success/server refresh, not pending or failed requests. */
export function InvoiceRefundPaymentForm(props: ComponentProps<typeof RefundPaymentForm>) {
  const { onSuccess: notifySuccess } = props;
  const [result,setResult]=useState<Awaited<ReturnType<typeof refundPresentationAction>>|null>(null);
  const [readVersion,setReadVersion]=useState(0);
  const onSuccess=useCallback(()=>{
    setReadVersion(version=>version+1);
    notifySuccess?.();
  },[notifySuccess]);
  useEffect(()=>{
    let live=true;
    void refundPresentationAction(props.invoiceId,props.paymentId).then(value=>{if(live)setResult(value);})
      .catch(()=>{if(live)setResult({ok:false,message:"Refund details could not be loaded. Close and reopen to try again."});});
    return()=>{live=false;};
  },[props.invoiceId,props.paymentId,props.refundableAmount,readVersion]);
  if(!result)return <p role="status">Loading refund details…</p>;
  if(!result.ok)return <p role="alert">{result.message}</p>;
  return <RefundPaymentForm {...props} refundableAmount={result.refundableAmount} packagePurchaseRefund={result.packagePurchaseRefund} onSuccess={onSuccess}/>;
}
