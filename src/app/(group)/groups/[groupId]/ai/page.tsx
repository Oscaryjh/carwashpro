import Link from "next/link";
import { notFound } from "next/navigation";
import { AiBusinessChat } from "@/components/ai-business-chat";
import { requireUser } from "@/lib/auth/session";
import { resolveAuthorizedGroupReportingScope } from "@/lib/business-groups/all-stores-access";
import { isBusinessModuleEnabled } from "@/lib/modules/entitlements";
import { getAiWorkspace } from "@/lib/ai/service";

type Props = { params: Promise<{ groupId: string }>; searchParams: Promise<{ conversationId?: string; range?: string; from?: string; to?: string }> };

export default async function GroupAiPage({ params, searchParams }: Props) {
  const [{ groupId }, query, user] = await Promise.all([params, searchParams, requireUser()]);
  const group = await resolveAuthorizedGroupReportingScope(user.userId, groupId, user.activeBusinessId);
  if (!group) notFound();
  const aiEnabled = await Promise.all(group.businesses.map((business) => isBusinessModuleEnabled(business.id, "AI")));
  if (!aiEnabled.some(Boolean)) notFound();
  const workspace = await getAiWorkspace({ userId: user.userId, groupId });
  const current = query.conversationId ? workspace.conversations.find((item) => item.id === query.conversationId) ?? null : null;
  const range = query.range ?? "month";
  const allowance = workspace.allowance;
  const quotaBlocked = !allowance.configured || allowance.status !== "ACTIVE" || allowance.remainingRequests === 0;

  return <section className="content ai-workspace">
    <div className="page-header"><div><h1>Ask Tetamu · All Stores</h1><p>Read-only analysis across {group.businesses.length} authorised business(es) in {group.groupName}.</p></div><Link href={`/groups/${groupId}/ai`}>New conversation</Link></div>
    <div className="ai-layout">
      <aside className="panel ai-sidebar">
        <Link href={`/groups/${groupId}/overview`}>← All Stores overview</Link>
        <h2>Conversations</h2>
        {workspace.conversations.length ? workspace.conversations.map((conversation) => <Link className={current?.id === conversation.id ? "active" : ""} key={conversation.id} href={`/groups/${groupId}/ai?conversationId=${conversation.id}&range=${range}`}>{conversation.title ?? "Group analysis"}<small>{conversation.updatedAt.toLocaleString("en-MY")}</small></Link>) : <p className="empty-state">No group conversations yet.</p>}
        <hr /><h3>Group AI allowance</h3>
        {allowance.configured ? <dl><div><dt>Used / included</dt><dd>{allowance.usedRequests} / {allowance.requestLimit ?? "Unlimited"}</dd></div><div><dt>Remaining</dt><dd>{allowance.remainingRequests ?? "Unlimited"}</dd></div><div><dt>Input tokens</dt><dd>{allowance.inputTokens.toLocaleString()}</dd></div><div><dt>Output tokens</dt><dd>{allowance.outputTokens.toLocaleString()}</dd></div><div><dt>Total tokens</dt><dd>{allowance.totalTokens.toLocaleString()}</dd></div><div><dt>Resets</dt><dd>{allowance.periodEnd.toLocaleDateString("en-MY", { timeZone: allowance.timezone })}</dd></div></dl> : <p className="empty-state">Not configured</p>}
        <hr /><dl><div><dt>Technical failures</dt><dd>{workspace.usage.failures}</dd></div></dl>
      </aside>
      <main className="ai-main">
        <section className="panel ai-scope-card"><div><span>Group</span><strong>{group.groupName}</strong></div><div><span>Businesses</span><strong>{aiEnabled.filter(Boolean).length} AI-enabled and authorised</strong></div><div><span>Period</span><strong>{range === "month" ? "This Month" : range.replaceAll("_", " ")}</strong></div></section>
        {current ? <section className="ai-history">{current.messages.map((message) => <article className={`ai-message ${message.role.toLowerCase()}`} key={message.id}><span>{message.role === "USER" ? "You" : "Tetamu AI"}</span><p>{message.content}</p>{message.role === "ASSISTANT" && message.structuredMetadata ? <GroupStructuredMetadata value={message.structuredMetadata} /> : null}</article>)}</section> : null}
        <AiBusinessChat scopeType="GROUP" groupId={groupId} conversationId={current?.id} range={range} from={query.from} to={query.to} quotaBlocked={quotaBlocked} quotaMessage={quotaMessage(allowance)} />
        <p className="performance-coverage-note">Only authorised businesses are included. Missing modules are not treated as zero. This is operational analysis, not accounting profit, and no business data can be changed.</p>
      </main>
    </div>
  </section>;
}

function GroupStructuredMetadata({ value }: { value: unknown }) {
  const data = value as { evidence?: Array<{ metricKey: string; label: string; value: string }>; caveats?: string[]; recommendations?: string[] };
  return <div className="ai-message-details">{data.evidence?.length ? <><h3>Evidence</h3><ul>{data.evidence.map((item, index) => <li key={`${item.metricKey}-${index}`}><strong>{item.label}:</strong> {item.value}</li>)}</ul></> : null}{data.caveats?.length ? <><h3>Caveats</h3><ul>{data.caveats.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{data.recommendations?.length ? <><h3>Advisory recommendations</h3><ul>{data.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></> : null}</div>;
}

function quotaMessage(allowance: Awaited<ReturnType<typeof getAiWorkspace>>["allowance"]) {
  if (!allowance.configured) return "AI allowance is not configured for this group. Contact Tetamu support.";
  if (allowance.status === "SUSPENDED") return "AI access is temporarily suspended for this group.";
  if (allowance.remainingRequests === 0) return "The group AI allowance for this period has been used. Existing conversations remain available.";
  return undefined;
}
