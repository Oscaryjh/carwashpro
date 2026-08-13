import Link from "next/link";
import { AiBusinessChat } from "@/components/ai-business-chat";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import { resolveExpenseReadScope } from "@/lib/expense/access";
import { getAiWorkspace } from "@/lib/ai/service";
import { prisma } from "@/lib/prisma";

type Props = { searchParams: Promise<{ conversationId?: string; branchId?: string; range?: string; from?: string; to?: string }> };

export default async function AiPage({ searchParams }: Props) {
  const context = await requireBusinessUserForModule("AI", "VIEW_AI_ANALYSIS");
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "AI_ANALYSIS_VIEW");
  const params = await searchParams;
  const scope = await resolveExpenseReadScope({ access: context.access, businessId: context.businessId, user: context.user });
  const selectedBranchId = params.branchId && scope.allowedBranchIds?.includes(params.branchId) ? params.branchId : null;
  const [workspace, business] = await Promise.all([
    getAiWorkspace({ userId: context.user.userId, businessId: context.businessId }),
    prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { name: true } }),
  ]);
  const current = params.conversationId
    ? workspace.conversations.find((item) => item.id === params.conversationId) ?? null
    : null;
  const range = params.range ?? "month";
  const allowance = workspace.allowance;
  const quotaBlocked = !allowance.configured || allowance.status !== "ACTIVE" || allowance.remainingRequests === 0;
  return <section className="content ai-workspace">
    <div className="page-header"><div><h1>Ask Tetamu</h1><p>Read-only analysis grounded in the Business Performance read model.</p></div><Link href="/ai">New conversation</Link></div>
    <div className="ai-layout">
      <aside className="panel ai-sidebar"><h2>Conversations</h2>{workspace.conversations.length ? workspace.conversations.map((conversation) => <Link className={current?.id === conversation.id ? "active" : ""} key={conversation.id} href={conversationHref(conversation.id, params)}>{conversation.title ?? "Business analysis"}<small>{conversation.updatedAt.toLocaleString("en-MY")}</small></Link>) : <p className="empty-state">No conversations yet.</p>}<hr /><h3>AI allowance</h3>{allowance.configured ? <dl><div><dt>Used / included</dt><dd>{allowance.usedRequests} / {allowance.requestLimit ?? "Unlimited"}</dd></div><div><dt>Remaining</dt><dd>{allowance.remainingRequests ?? "Unlimited"}</dd></div><div><dt>Input tokens</dt><dd>{allowance.inputTokens.toLocaleString()}</dd></div><div><dt>Output tokens</dt><dd>{allowance.outputTokens.toLocaleString()}</dd></div><div><dt>Total tokens</dt><dd>{allowance.totalTokens.toLocaleString()}</dd></div><div><dt>Resets</dt><dd>{allowance.periodEnd.toLocaleDateString("en-MY", { timeZone: allowance.timezone })}</dd></div></dl> : <p className="empty-state">Not configured</p>}<hr /><dl><div><dt>Technical failures</dt><dd>{workspace.usage.failures}</dd></div></dl></aside>
      <main className="ai-main">
        <section className="panel ai-scope-card"><div><span>Business</span><strong>{business.name}</strong></div><div><span>Scope</span><strong>{selectedBranchId ? scope.branches.find((branch) => branch.id === selectedBranchId)?.name : "All authorised branches"}</strong></div><div><span>Period</span><strong>{rangeLabel(range)}</strong></div></section>
        <form className="performance-filter-form panel" action="/ai"><input type="hidden" name="conversationId" value={current?.id ?? ""} /><label><span>Range</span><select name="range" defaultValue={range}><option value="today">Today</option><option value="this_week">This Week</option><option value="month">This Month</option><option value="last_month">Last Month</option><option value="custom">Custom</option></select></label><label><span>From</span><input type="date" name="from" defaultValue={params.from} /></label><label><span>To</span><input type="date" name="to" defaultValue={params.to} /></label><label><span>Branch</span><select name="branchId" defaultValue={selectedBranchId ?? ""}><option value="">All authorised branches</option>{scope.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button>Apply</button></form>
        {current ? <section className="ai-history">{current.messages.map((message) => <article className={`ai-message ${message.role.toLowerCase()}`} key={message.id}><span>{message.role === "USER" ? "You" : "Tetamu AI"}</span><p>{message.content}</p>{message.role === "ASSISTANT" && message.structuredMetadata ? <StructuredMetadata value={message.structuredMetadata} /> : null}</article>)}</section> : null}
        <AiBusinessChat scopeType="BUSINESS" conversationId={current?.id} branchId={selectedBranchId} range={range} from={params.from} to={params.to} quotaBlocked={quotaBlocked} quotaMessage={quotaMessage(allowance)} />
        <p className="performance-coverage-note">AI analysis may be imperfect. Verify important decisions against source reports. Income vs Recorded Business Spending is not accounting net profit. No business data can be changed from this page.</p>
      </main>
    </div>
  </section>;
}

function StructuredMetadata({ value }: { value: unknown }) {
  const data = value as { evidence?: Array<{ metricKey: string; label: string; value: string; comparison?: string | null }>; caveats?: string[]; recommendations?: string[] };
  return <div className="ai-message-details">{data.evidence?.length ? <><h3>Evidence</h3><ul>{data.evidence.map((item, index) => <li key={`${item.metricKey}-${index}`}><strong>{item.label}:</strong> {item.value}{item.comparison ? ` · ${item.comparison}` : ""}</li>)}</ul></> : null}{data.caveats?.length ? <><h3>Caveats</h3><ul>{data.caveats.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{data.recommendations?.length ? <><h3>Advisory recommendations</h3><ul>{data.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></> : null}</div>;
}
function conversationHref(id: string, params: Awaited<Props["searchParams"]>) { const query = new URLSearchParams({ conversationId: id, range: params.range ?? "month" }); if (params.branchId) query.set("branchId", params.branchId); if (params.from) query.set("from", params.from); if (params.to) query.set("to", params.to); return `/ai?${query}`; }
function rangeLabel(range: string) { return ({ today: "Today", this_week: "This Week", last_month: "Last Month", custom: "Custom", month: "This Month" } as Record<string, string>)[range] ?? "This Month"; }
function quotaMessage(allowance: Awaited<ReturnType<typeof getAiWorkspace>>["allowance"]) {
  if (!allowance.configured) return "AI allowance is not configured for this business. Contact Tetamu support.";
  if (allowance.status === "SUSPENDED") return "AI access is temporarily suspended for this business.";
  if (allowance.remainingRequests === 0) return `The AI allowance for this period has been used. Existing conversations remain available until it resets on ${allowance.periodEnd.toLocaleDateString("en-MY", { timeZone: allowance.timezone })}.`;
  return undefined;
}
