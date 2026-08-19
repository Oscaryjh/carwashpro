"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { createExpenseAction } from "@/app/(business)/expenses/actions";
import type { ExpenseDocumentScanDto } from "@/lib/expense/document-ai/service";
import { EXPENSE_PAYMENT_ACCOUNTS, expensePaymentAccountValue, resolveExpensePaymentAccount } from "@/lib/expense/payment-account";
import styles from "@/app/(business)/expenses/expense.module.css";

type Category = { id: string; name: string; requiresReceipt: boolean };
type Branch = { id: string; name: string };
type OpenShift = { availableCash: string; branchId: string; cashierName: string; id: string; isCurrentUser: boolean; startedAt: string };
type PaymentStatus = "UNPAID" | "PAID";
type ReviewKey = "amount" | "branch" | "category" | "date" | "description" | "payment";
type ReviewIssue = { key: ReviewKey; message: string; requiresAction: boolean; severity: "BLOCKING" | "REVIEW"; title: string };
type ReviewAcknowledgements = { category: boolean; date: boolean; payment: boolean };

export function ExpenseDocumentAutofillForm(props: {
  operationKey: string;
  categories: Category[];
  branches: Branch[];
  defaultBranchId: string | null;
  includeBusinessWide: boolean;
  autofillEnabled: boolean;
  openShifts: OpenShift[];
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const cameraRequestIdRef = useRef(0);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const cameraCanvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const manualReceiptRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLElement>(null);
  const expenseDateRef = useRef<HTMLInputElement>(null);
  const [scan, setScan] = useState<ExpenseDocumentScanDto | null>(null);
  const [lastDocumentFile, setLastDocumentFile] = useState<File | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanStage, setScanStage] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualEntrySelected, setManualEntrySelected] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [dateEditorExpanded, setDateEditorExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [acknowledged, setAcknowledged] = useState<ReviewAcknowledgements>({ category: false, date: false, payment: false });
  const [duplicateOverride, setDuplicateOverride] = useState(false);
  const [branchId, setBranchId] = useState(props.defaultBranchId ?? "");
  const [expenseDate, setExpenseDate] = useState(today());
  const [categoryId, setCategoryId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("UNPAID");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentSource, setPaymentSource] = useState("");
  const [cashierShiftId, setCashierShiftId] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  const routed = scan?.documentType === "SUPPLIER_INVOICE" || scan?.documentType === "CLAIM_RECEIPT";
  const automaticFailure = Boolean(scan?.warnings.some((warning) => /could not be read automatically/i.test(warning)));
  const selectedOpenShifts = props.openShifts.filter((shift) => shift.branchId === branchId);
  const automaticOpenShift = automaticDrawerShift(selectedOpenShifts);
  const effectiveCashierShiftId = paymentSource === "POS_DRAWER" && automaticOpenShift ? automaticOpenShift.id : cashierShiftId;
  const selectedDrawerShift = selectedOpenShifts.find((shift) => shift.id === effectiveCashierShiftId) ?? null;
  const drawerMath = drawerBalance(amount, selectedDrawerShift);
  const drawerBlocked = paymentStatus === "PAID" && paymentSource === "POS_DRAWER" && (!selectedDrawerShift || Boolean(drawerMath && drawerMath.shortfall > 0));
  const reviewIssues = useMemo(() => scan && !routed && !automaticFailure ? buildReviewIssues({
    acknowledged, amount, branchId, categoryId, description, expenseDate, includeBusinessWide: props.includeBusinessWide,
    cashierShiftId: effectiveCashierShiftId, drawerInsufficient: Boolean(drawerMath && drawerMath.shortfall > 0), paymentDate, paymentMethod, paymentSource, paymentStatus, scan,
  }) : [], [acknowledged, amount, automaticFailure, branchId, categoryId, description, drawerMath, effectiveCashierShiftId, expenseDate, paymentDate, paymentMethod, paymentSource, paymentStatus, props.includeBusinessWide, routed, scan]);
  const duplicateReviewRequired = Boolean(scan?.duplicateCandidates.length) && !duplicateOverride;
  const mustResolveReview = reviewIssues.some((issue) => issue.severity === "BLOCKING" || issue.requiresAction);
  const selectedBranchName = props.branches.find((branch) => branch.id === branchId)?.name ?? (branchId ? "Current branch" : "Business-wide");
  const selectedCategoryName = props.categories.find((category) => category.id === categoryId)?.name ?? "Review required";
  const compactReady = Boolean(scan && !routed && !automaticFailure && !mustResolveReview && !duplicateReviewRequired);
  const meaningfulWarnings = scan ? userFacingWarnings(scan.warnings) : [];

  useEffect(() => () => {
    cameraRequestIdRef.current += 1;
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!scanning) { setScanStage(0); return; }
    const timer = window.setInterval(() => setScanStage((value) => Math.min(value + 1, 3)), 700);
    return () => window.clearInterval(timer);
  }, [scanning]);

  useEffect(() => {
    if (cashierShiftId && !props.openShifts.some((shift) => shift.id === cashierShiftId && shift.branchId === branchId)) {
      setCashierShiftId("");
    }
  }, [branchId, cashierShiftId, props.openShifts]);

  function releaseCameraStream() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    if (cameraVideoRef.current) cameraVideoRef.current.srcObject = null;
  }

  function closeCamera() {
    cameraRequestIdRef.current += 1;
    releaseCameraStream();
    setCameraOpen(false);
    setCameraReady(false);
    setCameraError(null);
  }

  async function openCamera() {
    setScanError(null);
    if (!navigator.mediaDevices?.getUserMedia) { cameraRef.current?.click(); return; }
    releaseCameraStream();
    const requestId = ++cameraRequestIdRef.current;
    setCameraOpen(true); setCameraReady(false); setCameraError(null);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (requestId !== cameraRequestIdRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      cameraStreamRef.current = stream;
      const video = cameraVideoRef.current;
      if (!video) throw new Error("CAMERA_PREVIEW_UNAVAILABLE");
      video.srcObject = stream;
      await video.play();
      setCameraReady(true);
    } catch (error) {
      releaseCameraStream();
      if (requestId !== cameraRequestIdRef.current) return;
      const denied = error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError");
      setCameraError(denied ? "Camera permission was not allowed. Enable camera access in your browser, or upload a receipt instead." : "The camera could not be started. Check that your webcam is connected and not being used by another app.");
    }
  }

  async function capturePhoto() {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    if (!video || !canvas || !cameraReady || video.videoWidth < 1 || video.videoHeight < 1) {
      setCameraError("The camera is not ready yet. Wait for the preview, then try again."); return;
    }
    const maximumDimension = 2200;
    const scale = Math.min(1, maximumDimension / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) { setCameraError("The photo could not be prepared. Upload a receipt instead."); return; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) { setCameraError("The photo could not be prepared. Upload a receipt instead."); return; }
    const file = new File([blob], `receipt-camera-${Date.now()}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
    closeCamera();
    await scanDocument(file);
  }

  async function scanDocument(file: File | undefined) {
    if (!file) return;
    setLastDocumentFile(file);
    setManualEntrySelected(false); setDetailsExpanded(false); setDateEditorExpanded(false); setNotesExpanded(false);
    setScanning(true); setScanError(null); setScan(null); setDuplicateOverride(false); setReviewAttempted(false);
    setAcknowledged({ category: false, date: false, payment: false });
    try {
      const body = new FormData();
      body.set("document", file); body.set("branchId", branchId);
      const response = await fetch("/api/expenses/document-scans", { method: "POST", body });
      const result = await response.json() as ExpenseDocumentScanDto | { message?: string };
      if (!response.ok || !("id" in result)) throw new Error("message" in result ? result.message : "The document could not be scanned.");
      setScan(result);
      const suggested = result.suggested;
      setExpenseDate(suggested.expenseDate ?? "");
      setCategoryId(suggested.categoryId ?? "");
      setPayeeName(suggested.payeeName ?? "");
      setAmount(suggested.amount ?? "");
      setDescription(suggested.description ?? (suggested.payeeName ? `Expense at ${suggested.payeeName}` : ""));
      setPaymentStatus(suggested.paymentStatus);
      setPaymentMethod(suggested.paymentMethod ?? "");
      setPaymentSource("");
      setCashierShiftId("");
      setPaymentDate(suggested.paymentDate ?? "");
      setPaymentReference(suggested.paymentReference ?? "");
      if (manualReceiptRef.current) manualReceiptRef.current.value = "";
    } catch (error) {
      retainReceiptForManualEntry(file, manualReceiptRef.current);
      setScanError(error instanceof Error ? error.message : "The document could not be scanned.");
    } finally {
      setScanning(false);
      if (cameraRef.current) cameraRef.current.value = "";
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  function enterManually() {
    const receiptFile = lastDocumentFile;
    setScanError(null); setScan(null); setManualEntrySelected(true); setDetailsExpanded(true); setReviewAttempted(false);
    window.requestAnimationFrame(() => {
      if (receiptFile) retainReceiptForManualEntry(receiptFile, manualReceiptRef.current);
      document.getElementById("expense-details-section")?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start",
      });
      expenseDateRef.current?.focus({ preventScroll: true });
    });
  }

  function requestReviewAttention() {
    setReviewAttempted(true);
    window.requestAnimationFrame(() => {
      reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      reviewRef.current?.querySelector<HTMLElement>("[data-review-control], input[type='checkbox']")?.focus({ preventScroll: true });
    });
  }

  function acknowledge(key: keyof ReviewAcknowledgements) {
    setAcknowledged((current) => ({ ...current, [key]: true }));
    setReviewAttempted(false);
  }

  function changePaymentStatus(value: PaymentStatus) {
    setPaymentStatus(value); setAcknowledged((current) => ({ ...current, payment: true }));
    if (value === "UNPAID") { setPaymentMethod(""); setPaymentSource(""); setCashierShiftId(""); setPaymentDate(""); setPaymentReference(""); }
  }

  function changePaymentAccount(value: string) {
    const account = resolveExpensePaymentAccount(value);
    setPaymentMethod(account?.paymentMethod ?? "");
    setPaymentSource(account?.paymentSource ?? "");
    if (account?.paymentSource !== "POS_DRAWER") setCashierShiftId("");
    acknowledge("payment");
  }

  function submitGuard(event: FormEvent<HTMLFormElement>) {
    if (routed || automaticFailure || mustResolveReview || duplicateReviewRequired || drawerBlocked) {
      event.preventDefault(); requestReviewAttention();
    }
  }

  const categoryIssue = reviewIssues.find((issue) => issue.key === "category");
  const dateIssue = reviewIssues.find((issue) => issue.key === "date");
  const paymentIssue = reviewIssues.find((issue) => issue.key === "payment");
  const amountIssue = reviewIssues.find((issue) => issue.key === "amount");
  const descriptionIssue = reviewIssues.find((issue) => issue.key === "description");
  const branchIssue = reviewIssues.find((issue) => issue.key === "branch");

  return <form action={createExpenseAction} className={`${styles.cardForm} ${styles.compactExpenseForm}`} onSubmit={submitGuard}>
    <input type="hidden" name="operationKey" value={props.operationKey} />
    <input type="hidden" name="documentScanId" value={scan?.id ?? ""} />
    <input type="hidden" name="duplicateOverride" value={duplicateOverride ? "true" : "false"} />
    <input type="hidden" name="expenseDate" value={expenseDate} />
    <input type="hidden" name="branchId" value={branchId} />
    <input type="hidden" name="categoryId" value={categoryId} />
    <input type="hidden" name="payeeName" value={payeeName} />
    <input type="hidden" name="amount" value={amount} />
    <input type="hidden" name="description" value={description} />
    <input type="hidden" name="paymentStatus" value={paymentStatus} />
    <input type="hidden" name="paymentMethod" value={paymentMethod} />
    <input type="hidden" name="paymentSource" value={paymentSource} />
    <input type="hidden" name="cashierShiftId" value={effectiveCashierShiftId} />
    <input type="hidden" name="paymentDate" value={paymentDate} />
    <input type="hidden" name="paymentReference" value={paymentReference} />
    <input type="hidden" name="notes" value={internalNotes} />

    <div className={styles.formCards}>
      <section className={`panel ${styles.scanCard}`} aria-labelledby="receipt-autofill-heading">
        {!scan && !scanning ? <>
          <div className={styles.scanIntro}><div><span className={styles.eyebrow}>Receipt autofill</span><h2 id="receipt-autofill-heading">Add a receipt</h2><p>Take a photo or upload a receipt. Tetamu fills what it can; you review only what needs attention.</p></div></div>
          <div className={styles.scanActions}>
            {props.autofillEnabled ? <>
              <button type="button" onClick={() => void openCamera()}>Take photo</button>
              <button type="button" className="secondary-button" onClick={() => uploadRef.current?.click()}>Upload receipt</button>
            </> : null}
            <ManualEntryButton selected={manualEntrySelected} onClick={enterManually} />
          </div>
          {!props.autofillEnabled ? <p className={styles.manualOnly}>Document autofill is disabled in this environment. Manual expense entry remains available.</p> : null}
        </> : null}

        {scan && !scanning ? <div className={styles.scanCompleteBar}>
          <div><span aria-hidden="true">✓</span><p><strong>Receipt scanned</strong><small>Review the summary below. Change the receipt only if needed.</small></p></div>
          <div className={styles.scanReplacementActions}><button type="button" className={styles.scanReplaceButton} onClick={() => uploadRef.current?.click()}>Upload another</button><button type="button" className={styles.scanReplaceButton} onClick={() => void openCamera()}>Retake photo</button></div>
        </div> : null}

        <input ref={cameraRef} className={styles.hiddenFile} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => void scanDocument(event.target.files?.[0])} />
        <input ref={uploadRef} className={styles.hiddenFile} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void scanDocument(event.target.files?.[0])} />

        {scanning ? <div className={styles.scanningCard} role="status" aria-live="polite"><span className={styles.scanSpinner} /><div><strong>Scanning receipt…</strong><ul>{["Reading merchant", "Reading amount and date", "Checking category", "Checking duplicates"].map((item, index) => <li className={index <= scanStage ? styles.scanStageActive : ""} key={item}>{index < scanStage ? "✓" : "•"} {item}</li>)}</ul></div></div> : null}

        {scanError ? <div className={styles.aiFailureCard} role="alert"><div><strong>We couldn’t read this receipt automatically.</strong><p>{scanError} The selected file is still available for manual entry.</p></div><div>{lastDocumentFile ? <button type="button" className={styles.failureSecondaryButton} onClick={() => void scanDocument(lastDocumentFile)}>Try again</button> : null}<button type="button" className={styles.failurePrimaryButton} onClick={enterManually}>Enter details</button></div></div> : null}

        {cameraOpen ? <CameraDialog cameraCanvasRef={cameraCanvasRef} cameraError={cameraError} cameraReady={cameraReady} cameraVideoRef={cameraVideoRef} closeCamera={closeCamera} capturePhoto={capturePhoto} upload={() => { closeCamera(); uploadRef.current?.click(); }} /> : null}
      </section>

      {scan && automaticFailure ? <section className={`panel ${styles.aiFailureCard}`}><div><span className={styles.eyebrow}>Manual review required</span><h2>We couldn’t fill this receipt reliably</h2><p>The receipt is attached. Try the scan again, or continue by entering the details yourself.</p></div><div><button type="button" className={styles.failureSecondaryButton} onClick={() => lastDocumentFile && void scanDocument(lastDocumentFile)} disabled={!lastDocumentFile}>Try again</button><button type="button" className={styles.failurePrimaryButton} onClick={enterManually}>Enter details</button></div></section> : null}

      {scan && routed ? <RoutedDocumentCard scan={scan} /> : null}

      {scan && !routed && !automaticFailure ? <section ref={reviewRef} className={`panel ${styles.compactReviewCard}`} aria-labelledby="compact-review-heading">
        <header className={`${styles.reviewStatus} ${compactReady ? styles.reviewStatusReady : mustResolveReview ? styles.reviewStatusBlocked : styles.reviewStatusReview}`}>
          <span aria-hidden="true">{compactReady ? "✓" : "!"}</span>
          <div><strong>{compactReady ? "Ready to confirm" : `${reviewIssues.length + (duplicateReviewRequired ? 1 : 0)} item${reviewIssues.length + (duplicateReviewRequired ? 1 : 0) === 1 ? " needs" : "s need"} review`}</strong><small>{compactReady ? "All required values are resolved." : "Only the items below need your attention."}</small></div>
        </header>

        <div className={styles.merchantSummary}><span>{payeeName || "Merchant not detected"}</span><strong>{validMoney(amount) ? `RM${Number(amount).toFixed(2)}` : "Amount needs review"}</strong><time dateTime={expenseDate || undefined}>{humanDate(expenseDate)}</time>{description ? <p>{description}</p> : null}</div>

        <dl className={styles.compactSummary}>
          <div><dt>Category</dt><dd>{selectedCategoryName}</dd><small>{acknowledged.category ? "Confirmed by you" : scan.suggested.categoryConfidence === "HIGH" ? "Auto classified" : scan.suggested.categoryConfidence === "MEDIUM" ? "AI suggestion · Review recommended" : "Review required"}</small></div>
          <div><dt>Branch</dt><dd>{selectedBranchName}</dd></div>
          <div><dt>Payment</dt><dd>{paymentSummary(paymentStatus, paymentMethod)}</dd>{paymentStatus === "PAID" && paymentDate ? <small>{humanDate(paymentDate)}{paymentReference ? ` · Ref ${paymentReference}` : ""}</small> : paymentReference ? <small>Ref {paymentReference}</small> : null}</div>
          <div><dt>Receipt</dt><dd>{scan.suggested.invoiceNumber ? `#${scan.suggested.invoiceNumber} · Attached` : "Attached ✓"}</dd></div>
        </dl>

        {reviewIssues.length || duplicateReviewRequired || meaningfulWarnings.length ? <div className={styles.exceptionSection}>
          <div className={styles.exceptionHeader}><div><span className={styles.eyebrow}>Quick check</span><h3>Review before saving</h3></div><strong>{reviewIssues.length + (duplicateReviewRequired ? 1 : 0)} item{reviewIssues.length + (duplicateReviewRequired ? 1 : 0) === 1 ? "" : "s"}</strong></div>
          {dateIssue ? <ReviewBox issue={dateIssue} attempted={reviewAttempted}>
            <div className={styles.reviewBody}>
              <div className={styles.dateReviewSummary}>
                <span>Receipt date</span>
                <strong>{humanDate(expenseDate)}</strong>
                {scan.rawDocumentDate ? <p>Receipt shows <code>{scan.rawDocumentDate}</code> · interpreted as Malaysia’s day/month/year format.</p> : null}
              </div>
              {dateEditorExpanded ? <div className={styles.dateChangePanel}>
                <label>Choose another date<input data-review-control ref={expenseDateRef} type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} /></label>
                <p>Selected date: <strong>{humanDate(expenseDate)}</strong></p>
              </div> : null}
              <div className={styles.dateReviewActions}>
                {dateIssue.requiresAction && expenseDate ? <button type="button" onClick={() => { acknowledge("date"); setDateEditorExpanded(false); }}>Confirm {humanDate(expenseDate)}</button> : null}
                <button type="button" className={styles.reviewSecondaryButton} aria-expanded={dateEditorExpanded} onClick={() => setDateEditorExpanded((value) => !value)}>{dateEditorExpanded ? "Keep this date" : "Change date"}</button>
              </div>
            </div>
          </ReviewBox> : null}
          {categoryIssue ? <ReviewBox issue={categoryIssue} attempted={reviewAttempted}><div className={styles.reviewBody}><label>Category<select data-review-control value={categoryId} onChange={(event) => { setCategoryId(event.target.value); acknowledge("category"); }}><option value="" disabled>Select category</option>{props.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>{categoryId && categoryIssue.requiresAction ? <div className={styles.reviewActionBar}><button type="button" className={styles.reviewSecondaryButton} onClick={() => acknowledge("category")}>Use this category</button></div> : null}</div></ReviewBox> : null}
          {paymentIssue ? <ReviewBox issue={paymentIssue} attempted={reviewAttempted}><div className={styles.reviewBody}><div className={styles.reviewControlGrid}><label>Payment<select data-review-control value={paymentStatus} onChange={(event) => changePaymentStatus(event.target.value as PaymentStatus)}><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option></select></label>{paymentStatus === "PAID" ? <><label>Paid from<select value={expensePaymentAccountValue(paymentMethod, paymentSource)} onChange={(event) => changePaymentAccount(event.target.value)}><PaymentAccountOptions canUsePosDrawer={selectedOpenShifts.length > 0} /></select><small>The payment method is recorded automatically.</small></label>{paymentSource === "POS_DRAWER" ? automaticOpenShift ? <AutomaticOpenShift shift={automaticOpenShift} compact /> : <label>Which open POS shift?<select value={cashierShiftId} onChange={(event) => { setCashierShiftId(event.target.value); acknowledge("payment"); }}><option value="">Select open shift</option>{selectedOpenShifts.map((shift) => <option key={shift.id} value={shift.id}>{openShiftLabel(shift)}</option>)}</select></label> : null}<label>Date<input type="date" value={paymentDate} onChange={(event) => { setPaymentDate(event.target.value); acknowledge("payment"); }} /></label></> : null}</div>{paymentStatus === "PAID" && paymentSource === "POS_DRAWER" ? <DrawerBalanceNotice amount={amount} shift={selectedDrawerShift} /> : null}{paymentIssue.requiresAction ? <div className={styles.reviewActionBar}><button type="button" className={styles.reviewSecondaryButton} onClick={() => acknowledge("payment")} disabled={drawerBlocked}>{paymentStatus === "UNPAID" ? "Keep as unpaid" : drawerBlocked ? "Drawer payment unavailable" : "Confirm payment"}</button></div> : null}</div></ReviewBox> : null}
          {amountIssue ? <ReviewBox issue={amountIssue} attempted={reviewAttempted}><div className={styles.reviewBody}><label>Amount (MYR)<input data-review-control type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></label></div></ReviewBox> : null}
          {descriptionIssue ? <ReviewBox issue={descriptionIssue} attempted={reviewAttempted}><div className={styles.reviewBody}><label>Description<input data-review-control minLength={3} maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label></div></ReviewBox> : null}
          {branchIssue ? <ReviewBox issue={branchIssue} attempted={reviewAttempted}><div className={styles.reviewBody}><label>Branch<select data-review-control value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="" disabled>Select branch</option>{props.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label></div></ReviewBox> : null}
          {scan.duplicateCandidates.length ? <DuplicateReview scan={scan} duplicateOverride={duplicateOverride} setDuplicateOverride={(value) => { setDuplicateOverride(value); setReviewAttempted(false); }} /> : null}
          {meaningfulWarnings.length ? <details className={styles.scanNotes}><summary>Additional scan notes <span>{meaningfulWarnings.length}</span></summary><ul>{meaningfulWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details> : null}
        </div> : null}

        <div className={styles.compactCtas}>
          <button type={!drawerBlocked && (compactReady || (!mustResolveReview && !duplicateReviewRequired)) ? "submit" : "button"} name="intent" value="CONFIRMED" disabled={drawerBlocked} onClick={mustResolveReview || duplicateReviewRequired ? requestReviewAttention : undefined}>{drawerBlocked ? "POS drawer payment unavailable" : "Confirm Expense"}</button>
          <button type="button" className="secondary-button" aria-expanded={detailsExpanded} aria-controls="expense-details-section" onClick={() => setDetailsExpanded((value) => !value)}>{detailsExpanded ? "Hide details" : "Edit details"}</button>
        </div>
      </section> : null}

      {(manualEntrySelected || detailsExpanded) && !routed ? <section id="expense-details-section" className={`panel ${styles.unifiedEditor}`} aria-labelledby="expense-details-heading">
        <div className={styles.editorHeader}><div><span className={styles.eyebrow}>{manualEntrySelected && !scan ? "Manual entry" : "Full details"}</span><h2 id="expense-details-heading">Edit expense details</h2><p>Every AI suggestion remains editable. Your final values are used when you save.</p></div>{scan ? <button type="button" className="secondary-button" onClick={() => setDetailsExpanded(false)}>Done editing</button> : null}</div>

        <div className={styles.editorGroup}><h3>Expense</h3><div className={styles.fieldGrid}>
          <label>Expense Date <Required /><input ref={expenseDateRef} type="date" required value={expenseDate} onChange={(event) => { setExpenseDate(event.target.value); acknowledge("date"); }} /></label>
          <label>Branch <Required /><select required={!props.includeBusinessWide} value={branchId} onChange={(event) => setBranchId(event.target.value)}><option value="">{props.includeBusinessWide ? "Business-wide" : "Select branch"}</option>{props.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          <label>Category <Required /><select required value={categoryId} onChange={(event) => { setCategoryId(event.target.value); acknowledge("category"); }}><option value="" disabled>Select category</option>{props.categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.requiresReceipt ? " · Receipt required" : ""}</option>)}</select></label>
          <label>Payee<input maxLength={160} placeholder="e.g. Sabah Electricity or Landlord" value={payeeName} onChange={(event) => setPayeeName(event.target.value)} /></label>
          <label>Amount (MYR) <Required /><div className={styles.moneyInput}><span>RM</span><input aria-label="Amount in MYR" type="number" min="0.01" max="9999999999.99" step="0.01" inputMode="decimal" placeholder="0.00" required value={amount} onChange={(event) => setAmount(event.target.value)} /></div></label>
          <label className={styles.full}>Description <Required /><input minLength={3} maxLength={500} placeholder="What was this expense for?" required value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        </div></div>

        <div className={styles.editorGroup}><h3>Payment</h3><div className={styles.fieldGrid}>
          <label>Payment Status <Required /><select value={paymentStatus} onChange={(event) => changePaymentStatus(event.target.value as PaymentStatus)}><option value="UNPAID">Unpaid</option><option value="PAID">Paid</option></select><small>AI suggestions never override Tetamu’s payment evidence rules.</small></label>
          <label>Paid from / payment account<select required={paymentStatus === "PAID"} value={expensePaymentAccountValue(paymentMethod, paymentSource)} onChange={(event) => changePaymentAccount(event.target.value)}><PaymentAccountOptions canUsePosDrawer={selectedOpenShifts.length > 0} /></select><small>Tetamu records the matching method automatically. Only POS drawer cash reduces Shift Closing expected cash.</small></label>
          {paymentStatus === "PAID" && paymentSource === "POS_DRAWER" ? automaticOpenShift ? <AutomaticOpenShift shift={automaticOpenShift} /> : <label>Which open POS shift?<select required value={cashierShiftId} onChange={(event) => setCashierShiftId(event.target.value)}><option value="">Select open shift</option>{selectedOpenShifts.map((shift) => <option key={shift.id} value={shift.id}>{openShiftLabel(shift)}</option>)}</select><small>More than one drawer is open. Choose the drawer that is paying this expense.</small></label> : null}
          <label>Payment Date<input required={paymentStatus === "PAID"} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label>
          <label>Payment Reference<input maxLength={160} placeholder="Bank reference or receipt number" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} /></label>
        </div>{paymentStatus === "PAID" && paymentSource === "POS_DRAWER" ? <DrawerBalanceNotice amount={amount} shift={selectedDrawerShift} /> : null}</div>

        <div className={styles.editorGroup}><h3>Receipt & note</h3>{scan ? <div className={styles.attachmentReady}><span aria-hidden="true">✓</span><div><strong>Receipt attached</strong><small>The scanned receipt will be saved with this expense.</small></div><button type="button" className={styles.compactTextAction} onClick={() => uploadRef.current?.click()}>Replace</button></div> : <label className={styles.full}>Receipt / Attachment<input ref={manualReceiptRef} className={styles.fileInput} name="receipt" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /><small>JPG, PNG, WebP or PDF · maximum 10MB · stored privately.</small></label>}
          {notesExpanded ? <label className={styles.noteEditor}>Internal Notes<textarea maxLength={2000} rows={4} value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} placeholder="Optional notes for your team" /><button type="button" className={styles.compactTextAction} onClick={() => setNotesExpanded(false)}>Done</button></label> : <button type="button" className={styles.noteToggle} onClick={() => setNotesExpanded(true)}>{internalNotes ? "✓ Internal note added · Edit" : "+ Add internal note"}</button>}
        </div>

        <div className={styles.editorActions}><button name="intent" value="CONFIRMED" disabled={drawerBlocked}>{drawerBlocked ? "POS drawer payment unavailable" : "Create & Confirm"}</button><button className="secondary-button" name="intent" value="DRAFT" disabled={drawerBlocked}>Save as Draft</button></div>
      </section> : null}
    </div>
  </form>;
}

function ManualEntryButton({ selected, onClick }: { selected: boolean; onClick: () => void }) {
  return <button type="button" className={`${styles.manualEntryButton} ${selected ? styles.manualEntryButtonSelected : ""}`} aria-controls="expense-details-section" aria-pressed={selected} onClick={onClick}><span className={styles.manualEntryIcon} aria-hidden="true">{selected ? "✓" : "✎"}</span><span><strong>{selected ? "Manual entry selected" : "Enter manually"}</strong><small>{selected ? "Complete the details below" : "Skip scanning and fill in the form"}</small></span></button>;
}

function CameraDialog(props: { cameraCanvasRef: RefObject<HTMLCanvasElement | null>; cameraError: string | null; cameraReady: boolean; cameraVideoRef: RefObject<HTMLVideoElement | null>; capturePhoto: () => Promise<void>; closeCamera: () => void; upload: () => void }) {
  return <div className={styles.cameraOverlay} role="dialog" aria-modal="true" aria-labelledby="expense-camera-title" onMouseDown={(event) => { if (event.target === event.currentTarget) props.closeCamera(); }}><section className={styles.cameraDialog}><div className={styles.cameraHeader}><div><span>Receipt camera</span><h2 id="expense-camera-title">Position the receipt inside the frame</h2></div><button type="button" className={styles.cameraClose} aria-label="Close camera" onClick={props.closeCamera}>×</button></div><div className={styles.cameraViewport}><video ref={props.cameraVideoRef} muted playsInline aria-label="Live camera preview" />{!props.cameraReady && !props.cameraError ? <div className={styles.cameraLoading} role="status"><span />Starting camera…</div> : null}<div className={styles.cameraGuide} aria-hidden="true" /></div><canvas ref={props.cameraCanvasRef} className={styles.cameraCanvas} aria-hidden="true" />{props.cameraError ? <p className="form-message error" role="alert">{props.cameraError}</p> : <p className={styles.cameraHelp}>Keep the full receipt visible, avoid glare and hold the camera steady.</p>}<div className={styles.cameraActions}><button type="button" onClick={() => void props.capturePhoto()} disabled={!props.cameraReady}>Capture receipt</button><button type="button" className="secondary-button" onClick={props.upload}>Upload instead</button></div></section></div>;
}

function ReviewBox({ attempted, children, issue }: { attempted: boolean; children: ReactNode; issue: ReviewIssue }) {
  return <section className={`${styles.reviewBox} ${issue.severity === "BLOCKING" || (attempted && issue.requiresAction) ? styles.reviewBoxBlocking : ""}`}><div className={styles.reviewIntro}><span>{issue.severity === "BLOCKING" ? "Required" : "Check"}</span><strong>{issue.title}</strong><p>{issue.message}</p></div>{children}</section>;
}

function DuplicateReview({ duplicateOverride, scan, setDuplicateOverride }: { duplicateOverride: boolean; scan: ExpenseDocumentScanDto; setDuplicateOverride: (value: boolean) => void }) {
  return <section className={`${styles.reviewBox} ${styles.reviewBoxBlocking}`}><div className={styles.reviewIntro}><span>Check</span><strong>Possible duplicate</strong><p>A similar expense already exists. Open it before creating another.</p></div><div className={styles.duplicatePanel}>{scan.duplicateCandidates.map((candidate) => <Link key={`${candidate.recordType}:${candidate.recordId}`} href={candidate.href}><span>{candidate.recordType.replace("_", " ")} · {candidate.label}</span><small>{candidate.payee ?? "No payee"} · {humanDate(candidate.date)} · {candidate.amount ? `RM${candidate.amount}` : "No amount"} · {candidate.status}</small><b>View existing record →</b></Link>)}<label className={styles.overrideCheck}><input data-review-control type="checkbox" checked={duplicateOverride} onChange={(event) => setDuplicateOverride(event.target.checked)} /><span><strong>This is a separate expense</strong><small>I reviewed the existing record and want to continue.</small></span></label></div></section>;
}

function RoutedDocumentCard({ scan }: { scan: ExpenseDocumentScanDto }) {
  const supplier = scan.documentType === "SUPPLIER_INVOICE";
  return <section className={`panel ${styles.routedDocumentCard}`}><div className={styles.reviewStatus}><span aria-hidden="true">→</span><div><strong>{supplier ? "Supplier Invoice detected" : "Employee Claim receipt detected"}</strong><small>{supplier ? "This document belongs in Accounts Payable." : "This document belongs in employee Claims."}</small></div></div><div className={styles.routeSummary}><strong>{scan.suggested.payeeName ?? "Document review required"}</strong><span>{scan.suggested.amount ? `RM${scan.suggested.amount}` : "Amount not detected"}</span><time dateTime={scan.suggested.expenseDate ?? undefined}>{humanDate(scan.suggested.expenseDate)}</time>{scan.suggested.invoiceNumber ? <small>{supplier ? "Invoice" : "Receipt"} #{scan.suggested.invoiceNumber}</small> : null}</div><p>{supplier ? "Record this under Supplier Bills so inventory purchase spending and Accounts Payable remain canonical." : "Attach this document through My Claims so reimbursement and approval history remain canonical."}</p><Link className="primary-link-button" href={supplier ? "/inventory/supplier-bills/new" : "/staff/claims"}>{supplier ? "Create Supplier Bill" : "Open My Claims"}</Link></section>;
}

function buildReviewIssues(input: { acknowledged: ReviewAcknowledgements; amount: string; branchId: string; cashierShiftId: string; categoryId: string; description: string; drawerInsufficient: boolean; expenseDate: string; includeBusinessWide: boolean; paymentDate: string; paymentMethod: string; paymentSource: string; paymentStatus: PaymentStatus; scan: ExpenseDocumentScanDto }) {
  const issues: ReviewIssue[] = [];
  const dateConfidence = input.scan.fieldConfidence.documentDate;
  const dateWarning = input.scan.warnings.some((warning) => /invalid date|could not safely normalize|date conflict/i.test(warning));
  const trustedMalaysiaDate = isRecognisedMalaysianDate(input.scan.rawDocumentDate);
  const dateNeedsReview = dateWarning || (!trustedMalaysiaDate && (dateConfidence === null || dateConfidence < .75));
  if (!input.expenseDate) issues.push(blocking("date", "Date required", "Tetamu could not confidently detect the receipt date."));
  else if (dateNeedsReview && !input.acknowledged.date) issues.push(review("date", "Date needs review", "Check the receipt date before saving.", true));
  if (!validMoney(input.amount)) issues.push(blocking("amount", "Amount required", "Enter the receipt’s total amount."));
  if (!input.categoryId) issues.push(blocking("category", "Category required", "Choose an existing active Expense category."));
  if (!input.description.trim() || input.description.trim().length < 3) issues.push(blocking("description", "Description required", "Add a short description for this expense."));
  if (!input.branchId && !input.includeBusinessWide) issues.push(blocking("branch", "Branch required", "Choose an authorised branch for this expense."));
  if (input.paymentStatus === "PAID" && input.paymentSource === "POS_DRAWER" && input.drawerInsufficient) issues.push(blocking("payment", "Not enough POS drawer cash", "This payment cannot be recorded from the selected drawer. The expense remains Unpaid until another funding source or a smaller payment is selected."));
  else if (input.paymentStatus === "PAID" && (!input.paymentMethod || !input.paymentSource || !input.paymentDate || (input.paymentSource === "POS_DRAWER" && !input.cashierShiftId))) issues.push(blocking("payment", "Payment details required", "Paid expenses require a payment method, funding source and payment date. POS Drawer payments also require an open shift."));
  else if (input.paymentStatus === "UNPAID" && (input.scan.fieldConfidence.paymentStatus === null || input.scan.fieldConfidence.paymentStatus < .75) && !input.acknowledged.payment) issues.push(review("payment", "Payment needs review", "Tetamu kept this expense Unpaid because strong payment evidence was not found.", true));
  return issues;
}

function blocking(key: ReviewKey, title: string, message: string): ReviewIssue { return { key, message, requiresAction: true, severity: "BLOCKING", title }; }
function review(key: ReviewKey, title: string, message: string, requiresAction: boolean): ReviewIssue { return { key, message, requiresAction, severity: "REVIEW", title }; }
function validMoney(value: string) { return /^\d+(\.\d{1,2})?$/.test(value) && Number(value) > 0; }
function today() { return new Date().toISOString().slice(0, 10); }

function isRecognisedMalaysianDate(value: string | null) {
  if (!value) return false;
  const match = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?=$|[\s,])/.exec(value.trim());
  if (!match) return false;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function humanDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date needs review";
  const [year, month, day] = value.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[month - 1]} ${year}`;
}

function paymentSummary(status: PaymentStatus, method: string) {
  if (status === "UNPAID") return "Unpaid";
  const labels: Record<string, string> = { BANK_TRANSFER: "Bank transfer", CARD: "Card", CASH: "Cash", EWALLET: "E-wallet / DuitNow", OTHER: "Other" };
  return `Paid${method ? ` · ${labels[method] ?? method}` : " · Method needed"}`;
}

function PaymentAccountOptions({ canUsePosDrawer }: { canUsePosDrawer: boolean }) {
  return <><option value="" disabled>Select payment account</option>{EXPENSE_PAYMENT_ACCOUNTS.map((option) => <option key={option.value} value={option.value} disabled={option.paymentSource === "POS_DRAWER" && !canUsePosDrawer}>{option.label}{option.paymentSource === "POS_DRAWER" && !canUsePosDrawer ? " · no open shift" : ""}</option>)}</>;
}

function AutomaticOpenShift({ compact = false, shift }: { compact?: boolean; shift: OpenShift }) {
  return <div className={`${styles.automaticShift} ${compact ? styles.automaticShiftCompact : ""}`}>
    <div><span>Current POS shift</span><strong>{shift.cashierName}</strong></div>
    <div><span>Opened</span><strong>{new Date(shift.startedAt).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" })}</strong></div>
    {!compact ? <div><span>Available cash</span><strong>RM {shift.availableCash}</strong></div> : null}
    <small>Selected automatically</small>
  </div>;
}

function automaticDrawerShift(shifts: OpenShift[]) {
  const currentUserShifts = shifts.filter((shift) => shift.isCurrentUser);
  if (currentUserShifts.length === 1) return currentUserShifts[0];
  return shifts.length === 1 ? shifts[0] : null;
}

function openShiftLabel(shift: OpenShift) {
  return `${shift.cashierName} · opened ${new Date(shift.startedAt).toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" })} · RM ${shift.availableCash} available`;
}

function drawerBalance(amount: string, shift: OpenShift | null) {
  if (!shift) return null;
  const requested = Number(amount);
  const available = Number(shift.availableCash);
  if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(available)) return null;
  return { available, remaining: available - requested, requested, shortfall: Math.max(0, requested - available) };
}

function DrawerBalanceNotice({ amount, shift }: { amount: string; shift: OpenShift | null }) {
  const balance = drawerBalance(amount, shift);
  const blocked = !shift || Boolean(balance && balance.shortfall > 0);
  return <section className={`${styles.drawerBalanceCard} ${blocked ? styles.drawerBalanceBlocked : styles.drawerBalanceReady}`} aria-live="polite">
    {!shift ? <><strong>Select an open POS shift</strong><span>The expense stays Unpaid until a valid drawer is selected.</span></> : balance ? <><div><span>Drawer available</span><strong>RM {balance.available.toFixed(2)}</strong></div><div><span>This expense</span><strong>RM {balance.requested.toFixed(2)}</strong></div><div><span>{balance.shortfall > 0 ? "Short by" : "Remaining after payment"}</span><strong>RM {Math.abs(balance.shortfall > 0 ? balance.shortfall : balance.remaining).toFixed(2)}</strong></div><p>{balance.shortfall > 0 ? "Not enough drawer cash. This payment cannot be recorded; the expense remains Unpaid. Choose another funding source." : "Enough expected cash is available. The server will verify the balance again when you submit."}</p></> : <><strong>Enter a valid expense amount</strong><span>The drawer balance will be checked before submission.</span></>}
  </section>;
}

function userFacingWarnings(warnings: string[]) {
  return warnings.filter((warning) => !/ambiguous|DD\/MM\/YYYY|low-confidence extraction|verify every field|total amount was not|document date was not|possible duplicate|supplier invoice|claim receipt|could not be read automatically/i.test(warning));
}

function retainReceiptForManualEntry(file: File, input: HTMLInputElement | null) {
  if (!input || typeof DataTransfer === "undefined") return;
  const transfer = new DataTransfer(); transfer.items.add(file); input.files = transfer.files;
}

function Required() { return <span className={styles.required} aria-hidden="true">*</span>; }
