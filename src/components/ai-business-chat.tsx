"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { ASK_TETAMU_SUGGESTED_QUESTIONS } from "@/lib/ai/presentation";
import styles from "./ask-tetamu.module.css";

export function AiBusinessChat(props: {
  scopeType: "BUSINESS" | "GROUP";
  groupId?: string;
  conversationId?: string | null;
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
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(value?: string) {
    const nextQuestion = (value ?? question).trim();
    if (!nextQuestion || pending || props.quotaBlocked) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: props.scopeType,
          groupId: props.groupId,
          conversationId: props.conversationId,
          question: nextQuestion,
          clientRequestId: crypto.randomUUID(),
          branchId: props.branchId,
          range: props.range,
          from: props.from,
          to: props.to,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Ask Tetamu is temporarily unavailable. Please try again.");
      setQuestion("");
      const base = props.scopeType === "GROUP" ? `/groups/${props.groupId}/ai` : "/ai";
      const query = new URLSearchParams({ conversationId: payload.conversationId, range: props.range });
      if (props.branchId) query.set("branchId", props.branchId);
      if (props.from) query.set("from", props.from);
      if (props.to) query.set("to", props.to);
      router.replace(`${base}?${query}`);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Ask Tetamu is temporarily unavailable. Please try again.");
    } finally {
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

  return (
    <section className={styles.composerSection} aria-labelledby="ask-tetamu-composer-title">
      {props.showSuggestions && !props.quotaBlocked ? (
        <div className={styles.suggestions}>
          <div>
            <h2>Suggested questions</h2>
            <p>Start with a question Tetamu can answer from your business records.</p>
          </div>
          <div className={styles.suggestionChips} aria-label="Suggested questions">
            {ASK_TETAMU_SUGGESTED_QUESTIONS.map((item) => (
              <button type="button" key={item} disabled={pending} onClick={() => void submit(item)}>{item}</button>
            ))}
          </div>
        </div>
      ) : null}

      {props.quotaBlocked ? (
        <div className={styles.disabledState} role="status">
          <strong>{props.disabledTitle ?? "Ask Tetamu is unavailable"}</strong>
          <p>{props.disabledReason ?? props.quotaMessage ?? "Ask Tetamu is not enabled for this business."}</p>
        </div>
      ) : null}

      {pending ? (
        <div className={styles.thinkingBubble} role="status" aria-live="polite">
          <span aria-hidden="true" />
          <div><strong>Thinking…</strong><small>Reviewing the selected business records</small></div>
        </div>
      ) : null}

      <form className={styles.composer} onSubmit={onSubmit}>
        <label htmlFor="ask-tetamu-question" id="ask-tetamu-composer-title">Ask Tetamu about your business</label>
        <div className={styles.composerBox}>
          <textarea
            id="ask-tetamu-question"
            value={question}
            maxLength={2000}
            rows={3}
            disabled={props.quotaBlocked || pending}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ask about sales, expenses, inventory, customers, staff or supplier bills..."
          />
          <button type="submit" disabled={props.quotaBlocked || pending || !question.trim()}>
            {pending ? "Thinking…" : "Ask"}
          </button>
        </div>
        <div className={styles.composerMeta}>
          {props.remainingRequests != null && !props.quotaBlocked ? (
            <small className={props.usageWarning ? styles.quotaLow : styles.quotaRemaining} role={props.usageWarning ? "status" : undefined}>
              {props.usageWarning ?? `${props.remainingRequests} Ask Tetamu questions remaining this month`}
            </small>
          ) : <span />}
          <small>Enter to ask · Shift + Enter for a new line</small>
        </div>
      </form>
      {error ? <p className={styles.errorState} role="alert">{error}</p> : null}
    </section>
  );
}
