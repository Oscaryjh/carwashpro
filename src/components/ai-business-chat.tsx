"use client";

import { useEffect, useRef, useState, type ReactNode, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ASK_TETAMU_SUGGESTED_QUESTIONS } from "@/lib/ai/presentation";
import styles from "./ask-tetamu.module.css";

export function AiBusinessChat(props: {
  scopeType: "BUSINESS" | "GROUP";
  groupId?: string;
  conversationId?: string | null;
  requestStorageKey?: string;
  branchId?: string | null;
  range: string;
  from?: string;
  to?: string;
  quotaBlocked?: boolean;
  disabledReason?: string;
  disabledTitle?: string;
  quotaMessage?: string;
  usageWarning?: string;
  remainingRequests?: number | null;
  showSuggestions?: boolean;
  presentation?: "conversation";
  history?: ReactNode;
  messageCount?: number;
  footer?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyStateNotice?: boolean;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const submittingRef = useRef(false);
  const attemptRef = useRef<{ semantic: string; body: string } | null>(null);
  const blocked = props.quotaBlocked || Boolean(monthlyLimit);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const conversational = props.presentation === "conversation";
  useEffect(() => {
    if (!props.requestStorageKey) return;
    try {
      const saved = window.sessionStorage.getItem(props.requestStorageKey);
      if (!saved) return;
      const attempt = JSON.parse(saved);
      const body = JSON.parse(attempt.body);
      if (typeof attempt.semantic !== "string" || typeof body.question !== "string" || body.question.length > 2000 || typeof body.clientRequestId !== "string") return;
      attemptRef.current = attempt;
      setQuestion(body.question);
      setError("An earlier response could not be received. Retry to check the original request.");
      setCanRetry(true);
    } catch { /* Storage can be disabled; same-mounted-session retry still works. */ }
  }, [props.requestStorageKey]);
  useEffect(() => {
    if (!conversational || !historyRef.current) return;
    historyRef.current.scrollTop = historyRef.current.scrollHeight;
  }, [conversational, props.conversationId, props.messageCount]);

  async function submit(value?: string, retry = false) {
    const nextQuestion = (value ?? question).trim();
    if (!nextQuestion || submittingRef.current || blocked) return;
    const draft = { scopeType: props.scopeType, groupId: props.groupId, conversationId: props.conversationId,
      question: nextQuestion, branchId: props.branchId, range: props.range, from: props.from, to: props.to };
    const semantic = JSON.stringify(draft);
    if (!attemptRef.current || (!retry && attemptRef.current.semantic !== semantic)) {
      attemptRef.current = { semantic, body: JSON.stringify({ ...draft, clientRequestId: crypto.randomUUID() }) };
    }
    const requestBody = attemptRef.current.body;
    const requested = JSON.parse(requestBody) as typeof draft;
    try { if (props.requestStorageKey) window.sessionStorage.setItem(props.requestStorageKey, JSON.stringify(attemptRef.current)); } catch { /* Optional browser persistence. */ }
    submittingRef.current = true;
    setPending(true);
    setError("");
    setCanRetry(false);
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: requestBody,
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.error === "AI_QUOTA_EXCEEDED") { setMonthlyLimit(payload.message ?? "Monthly AI limit reached."); router.refresh(); }
        if (payload.error && payload.error !== "AI_REQUEST_PENDING") {
          try { if (props.requestStorageKey) window.sessionStorage.removeItem(props.requestStorageKey); } catch { /* Optional storage. */ }
        }
        throw Object.assign(new Error(payload.message ?? "Ask Tetamu is temporarily unavailable. Please try again."), {
          terminal: payload.error && payload.error !== "AI_REQUEST_PENDING",
        });
      }
      attemptRef.current = null;
      try { if (props.requestStorageKey) window.sessionStorage.removeItem(props.requestStorageKey); } catch { /* Optional storage. */ }
      setQuestion("");
      const base = requested.scopeType === "GROUP" ? `/groups/${requested.groupId}/ai` : "/ai";
      const query = new URLSearchParams({ conversationId: payload.conversationId, range: requested.range });
      if (requested.branchId) query.set("branchId", requested.branchId);
      if (requested.from) query.set("from", requested.from);
      if (requested.to) query.set("to", requested.to);
      router.replace(`${base}?${query}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof SyntaxError || failure instanceof TypeError ? "The response could not be received. Retry to check the original request."
        : failure instanceof Error ? failure.message : "Ask Tetamu is temporarily unavailable. Please try again.");
      setCanRetry(!(failure && typeof failure === "object" && "terminal" in failure && failure.terminal));
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  const suggestions = <>
      {props.showSuggestions && !blocked ? (
        <div className={styles.suggestions}>
          <div>
            <h2>Suggested questions</h2>
            <p>Start with a question Tetamu can answer from your business records.</p>
          </div>
          <div className={styles.suggestionChips} aria-label="Suggested questions">
            {(conversational ? ["How are sales this month?", "How much have we spent this month?", "Which inventory items need attention?", "How are appointments this month?"] : ASK_TETAMU_SUGGESTED_QUESTIONS).map((item) => (
              <button type="button" key={item} disabled={pending} onClick={() => { if (conversational) { setQuestion(item); inputRef.current?.focus(); } else { void submit(item); } }}>{item}</button>
            ))}
          </div>
        </div>
      ) : null}
  </>;
  const composer = <section className={styles.composerSection} aria-label="Ask Tetamu composer">
      {!conversational ? suggestions : null}
      {blocked && !(conversational && props.emptyStateNotice && !props.history) ? (
        <div className={styles.disabledState} role="status">
          <strong>{monthlyLimit ? "Monthly AI limit reached" : props.disabledTitle ?? "Ask Tetamu is unavailable"}</strong>
          <p>{monthlyLimit || props.disabledReason || props.quotaMessage || "Ask Tetamu is not enabled for this business."}</p>
        </div>
      ) : null}

      {pending ? (
        <div className={styles.thinkingBubble} role="status" aria-live="polite">
          <span aria-hidden="true" />
          <div><strong>Thinking…</strong><small>Reviewing the selected business records</small></div>
        </div>
      ) : null}

      {!conversational || !blocked ? <form className={styles.composer} onSubmit={onSubmit}>
        <label htmlFor="ask-tetamu-question" id="ask-tetamu-composer-title">Ask Tetamu about your business</label>
        <div className={styles.composerBox}>
          <textarea
            id="ask-tetamu-question"
            ref={inputRef}
            value={question}
            maxLength={2000}
            rows={3}
            disabled={blocked || pending}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={conversational ? "Ask about your business..." : "Ask about sales, expenses, inventory, customers, staff or supplier bills..."}
          />
          <button type="submit" aria-label={pending ? "Ask Tetamu is thinking" : "Send question"} disabled={blocked || pending || !question.trim()}>
            {pending ? conversational ? "…" : "Thinking…" : conversational ? "↑" : "Ask"}
          </button>
        </div>
        <div className={styles.composerMeta}>
          {props.remainingRequests != null && !blocked ? (
            <small className={props.usageWarning ? styles.quotaLow : styles.quotaRemaining} role={props.usageWarning ? "status" : undefined}>
              {props.usageWarning ?? `${props.remainingRequests} Ask Tetamu questions remaining this month`}
            </small>
          ) : <span />}
          <small>Enter to ask · Shift + Enter for a new line</small>
        </div>
      </form> : null}
      {error ? <p className={styles.errorState} role="alert">{error}</p> : null}
      {error && canRetry && !blocked ? <button type="button" disabled={pending} onClick={() => void submit(undefined, true)}>Retry</button> : null}
      {props.footer}
    </section>;
  if (!conversational) return composer;
  return <div className={styles.chatConversation}>
    <div className={styles.chatScroll} ref={historyRef} aria-label="Conversation messages" tabIndex={0}>
      {props.history ?? <div className={styles.chatEmpty} role={props.emptyStateNotice && blocked ? "status" : undefined}><span aria-hidden="true">✦</span><h2>{props.emptyTitle ?? "What would you like to know?"}</h2><p>{props.emptyDescription ?? "Ask Tetamu a question about your business."}</p>{suggestions}</div>}
    </div>
    {composer}
  </div>;
}
