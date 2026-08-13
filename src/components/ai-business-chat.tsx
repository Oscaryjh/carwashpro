"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Analysis = {
  summary: string;
  evidence: Array<{ metricKey: string; label: string; value: string; comparison: string | null; scope: string; period: string }>;
  caveats: string[];
  recommendations: string[];
  followUpQuestions: string[];
};

export function AiBusinessChat(props: {
  scopeType: "BUSINESS" | "GROUP";
  groupId?: string;
  conversationId?: string | null;
  branchId?: string | null;
  range: string;
  from?: string;
  to?: string;
  quotaBlocked?: boolean;
  quotaMessage?: string;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(value?: string) {
    const nextQuestion = (value ?? question).trim();
    if (!nextQuestion || pending || props.quotaBlocked) return;
    setPending(true); setError("");
    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: props.scopeType, groupId: props.groupId,
          conversationId: props.conversationId, question: nextQuestion,
          clientRequestId: crypto.randomUUID(), branchId: props.branchId,
          range: props.range, from: props.from, to: props.to,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? "Analysis is temporarily unavailable.");
      setAnalysis(payload.analysis); setQuestion("");
      const base = props.scopeType === "GROUP" ? `/groups/${props.groupId}/ai` : "/ai";
      const query = new URLSearchParams({ conversationId: payload.conversationId, range: props.range });
      if (props.branchId) query.set("branchId", props.branchId);
      if (props.from) query.set("from", props.from);
      if (props.to) query.set("to", props.to);
      router.replace(`${base}?${query}`); router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Analysis is temporarily unavailable.");
    } finally { setPending(false); }
  }

  return <div className="ai-chat-composer">
    <div className="ai-suggestions" aria-label="Suggested questions">
      {["Why are sales down this month?", "What is my profit this month?", "Which inventory items need attention?", "What supplier bills need attention?"].map((item) =>
        <button type="button" key={item} disabled={pending || props.quotaBlocked} onClick={() => submit(item)}>{item}</button>)}
    </div>
    {props.quotaBlocked ? <p className="form-message error" role="status">{props.quotaMessage ?? "AI allowance is unavailable for this scope."}</p> : null}
    <label><span>Ask about the selected canonical business period</span><textarea value={question} maxLength={2000} rows={3} disabled={props.quotaBlocked} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask Tetamu a read-only business question…" /></label>
    <button className="primary" type="button" disabled={props.quotaBlocked || pending || !question.trim()} onClick={() => submit()}>{pending ? "Analysing…" : "Ask Tetamu"}</button>
    {error ? <p className="form-message error" role="alert">{error}</p> : null}
    {analysis ? <article className="panel ai-answer" aria-live="polite"><h2>Latest analysis</h2><p>{analysis.summary}</p>{analysis.evidence.length ? <><h3>Evidence</h3><div className="ai-evidence-grid">{analysis.evidence.map((item, index) => <div key={`${item.metricKey}-${item.scope}-${index}`}><span>{item.label}</span><strong>{item.value}</strong><small>{item.comparison ?? item.period}</small></div>)}</div></> : null}<List title="Caveats" items={analysis.caveats} /><List title="Advisory recommendations" items={analysis.recommendations} /><List title="Follow-up questions" items={analysis.followUpQuestions} /></article> : null}
  </div>;
}

function List({ title, items }: { title: string; items: string[] }) {
  return items.length ? <section><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section> : null;
}
