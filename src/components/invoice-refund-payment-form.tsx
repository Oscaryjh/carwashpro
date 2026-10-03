"use client";

import {useEffect,useState,type ComponentProps} from "react";
import {refundPresentationAction} from "@/app/(business)/invoices/refund-presentation";
import {RefundPaymentForm} from "./refund-payment-form";

/** Load presentation once before mounting the form; never refresh a pending request. */
export function InvoiceRefundPaymentForm(props: ComponentProps<typeof RefundPaymentForm>) {
  const [result,setResult]=useState<Awaited<ReturnType<typeof refundPresentationAction>>|null>(null);
  useEffect(()=>{
    let live=true;setResult(null);
    void refundPresentationAction(props.invoiceId,props.paymentId).then(value=>{if(live)setResult(value);})
      .catch(()=>{if(live)setResult({ok:false,message:"Refund details could not be loaded. Close and reopen to try again."});});
    return()=>{live=false;};
  },[props.invoiceId,props.paymentId]);
  if(!result)return <p role="status">Loading refund details…</p>;
  if(!result.ok)return <p role="alert">{result.message}</p>;
  return <RefundPaymentForm {...props} refundableAmount={result.refundableAmount} packagePurchaseRefund={result.packagePurchaseRefund}/>;
}
