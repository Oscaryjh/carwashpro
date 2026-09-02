import Link from "next/link";
import { AiBusinessChat } from "@/components/ai-business-chat";
import { ArchiveConversationButton, RestoreConversationButton } from "@/components/ai-conversation-actions";
import styles from "@/components/ask-tetamu.module.css";
import { assertStaffPermission } from "@/lib/auth/staff-permissions";
import { requireBusinessUserForModule } from "@/lib/auth/business-user";
import {
  AI_RANGE_OPTIONS,
  aiRangeLabel,
  aiScopeSummary,
  buildAiSourceActions,
  getAiUsageNotice,
  normalizeAiRange,
  showsCustomAiDates,
  type AiScopeSnapshot,
  type AiSourceDomain,
} from "@/lib/ai/presentation";
import { getAiWorkspace } from "@/lib/ai/service";
import { prisma } from "@/lib/prisma";
import type { AiAnswerLanguage, AiIntent, AiTemporalSemantics } from "@/lib/ai/intent";

type SearchParams = { conversationId?: string; range?: string; from?: string; to?: string; view?: string };
type Props = { searchParams: Promise<SearchParams> };

export default async function AiPage({ searchParams }: Props) {
  const context = await requireBusinessUserForModule("AI", "VIEW_AI_ANALYSIS");
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "AI_ANALYSIS_VIEW");
  const params = await searchParams;
  const showArchived = params.view === "archived";
  const [workspace, business, archivedConversations] = await Promise.all([
    getAiWorkspace({ userId: context.user.userId, businessId: context.businessId }),
    prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { name: true } }),
    prisma.aiConversation.findMany({
      where: {
        createdById: context.user.userId,
        businessId: context.businessId,
        groupId: null,
        archivedAt: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 30,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 50 } },
    }),
  ]);
  const visibleConversations = showArchived ? archivedConversations : workspace.conversations;
  const current = params.conversationId
    ? visibleConversations.find((item) => item.id === params.conversationId) ?? null
    : null;
  const range = normalizeAiRange(params.range);
  const allowance = workspace.allowance;
  const usageNotice = getAiUsageNotice(allowance);
  const quotaBlocked = !allowance.configured || allowance.status !== "ACTIVE" || allowance.remainingRequests === 0;
  const disabledReason = quotaMessage(allowance, usageNotice);
  const sidebar = (
    <ConversationList
      currentId={current?.id}
      conversations={visibleConversations}
      params={{ ...params, range }}
      archivedMode={showArchived}
    />
  );

  return (
    <section className={`content ${styles.workspace}`}>
      <header className={styles.pageHeader}>
        <div><span>Business assistant</span><h1>Ask Tetamu</h1><p>Ask what is happening in your business using your authorised Tetamu records.</p></div>
        <p>Read-only</p>
      </header>

      <details className={styles.mobileConversations}>
        <summary>{showArchived ? "Archived conversations" : "Conversations"} <span>{visibleConversations.length}</span></summary>
        {sidebar}
      </details>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>{sidebar}</aside>
        <main className={styles.main}>
          <section className={styles.contextBar} aria-label="Current Ask Tetamu context">
            <div><span>Business</span><strong>{business.name}</strong></div>
            <div><span>Period</span><strong>{aiRangeLabel(range)}</strong></div>
          </section>

          <section className={styles.filterPanel} aria-labelledby="ask-context-heading">
            <div className={styles.filterHeading}><div><h2 id="ask-context-heading">Question period</h2><p>Choose the business period Tetamu should use.</p></div></div>
            <nav className={styles.rangeTabs} aria-label="Ask Tetamu period">
              {AI_RANGE_OPTIONS.map((option) => (
                <Link
                  key={option.value}
                  className={range === option.value ? styles.activeRange : ""}
                  aria-current={range === option.value ? "page" : undefined}
                  href={rangeHref(option.value, params)}
                >{option.label}</Link>
              ))}
            </nav>
            {showsCustomAiDates(range) ? <form className={styles.filterForm} action="/ai">
              <input type="hidden" name="conversationId" value={current?.id ?? ""} />
              <input type="hidden" name="range" value={range} />
              <label><span>From</span><input type="date" name="from" defaultValue={params.from} required /></label>
              <label><span>To</span><input type="date" name="to" defaultValue={params.to} required /></label>
              <button type="submit">Apply</button>
            </form> : null}
          </section>

          <section className={styles.conversation} aria-label="Ask Tetamu conversation">
            {current ? (
              <div className={styles.history}>
                {current.messages.map((message) => (
                  <article className={`${styles.message} ${message.role === "USER" ? styles.userMessage : styles.assistantMessage}`} key={message.id}>
                    <header><strong>{message.role === "USER" ? "You" : "Ask Tetamu"}</strong><time dateTime={message.createdAt.toISOString()}>{message.createdAt.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</time></header>
                    <p>{message.content}</p>
                    {message.role === "ASSISTANT" && message.structuredMetadata ? <StructuredMetadata value={message.structuredMetadata} /> : null}
                  </article>
                ))}
              </div>
            ) : showArchived ? (
              <div className={styles.emptyConversation}>
                <span aria-hidden="true">↺</span>
                <div><h2>Archived conversations</h2><p>Choose a conversation to review it or restore it to your active list.</p></div>
              </div>
            ) : (
              <div className={styles.emptyConversation}>
                <span aria-hidden="true">?</span>
                <div><h2>What would you like to know?</h2><p>Ask Tetamu a question to start your first conversation.</p></div>
              </div>
            )}

            {showArchived ? (
              <section className={styles.archivedConversationNotice}>
                <div><strong>{current ? "This conversation is archived" : "Archive view"}</strong><p>{current ? "Restore it to continue the conversation." : "Archived conversations are retained until you restore them."}</p></div>
                {current ? <RestoreConversationButton conversationId={current.id} /> : null}
              </section>
            ) : <AiBusinessChat
              scopeType="BUSINESS"
              conversationId={current?.id}
              range={range}
              from={params.from}
              to={params.to}
              quotaBlocked={quotaBlocked}
              disabledReason={disabledReason}
              disabledTitle={usageNotice?.kind === "EXHAUSTED" ? "Monthly limit reached" : undefined}
              usageWarning={usageNotice?.kind === "LOW" ? usageNotice.message : undefined}
              remainingRequests={allowance.remainingRequests}
              showSuggestions={!current || current.messages.length === 0}
            />}
          </section>
          <p className={styles.readOnlyNotice}>Ask Tetamu is read-only. Verify important figures against source reports.</p>
        </main>
      </div>
    </section>
  );
}

function ConversationList({ currentId, conversations, params, archivedMode }: {
  currentId?: string;
  conversations: Awaited<ReturnType<typeof getAiWorkspace>>["conversations"];
  params: SearchParams;
  archivedMode: boolean;
}) {
  return <div className={styles.conversationList}>
    <div className={styles.sidebarHeading}><div><h2>{archivedMode ? "Archived" : "Conversations"}</h2><small>{archivedMode ? "Removed from your list" : "Recent questions"}</small></div>{archivedMode ? null : <Link href={newConversationHref(params)} aria-label="Start a new conversation">+ New</Link>}</div>
    <nav aria-label="Ask Tetamu conversations">
      {conversations.length ? conversations.map((conversation) => {
        const title = conversation.title ?? "Business question";
        return <div className={styles.conversationRow} key={conversation.id}>
          <Link className={currentId === conversation.id ? styles.activeConversation : ""} href={conversationHref(conversation.id, params)}><strong>{title}</strong><small>{conversation.updatedAt.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</small></Link>
          {archivedMode ? <RestoreConversationButton conversationId={conversation.id} iconOnly /> : <ArchiveConversationButton conversationId={conversation.id} title={title} />}
        </div>;
      }) : <div className={styles.emptySidebar}><strong>{archivedMode ? "No archived conversations" : "No conversations yet"}</strong><p>{archivedMode ? "Conversations you remove will appear here." : "Ask Tetamu a question to start your first conversation."}</p></div>}
    </nav>
    <footer className={styles.conversationListFooter}>
      <Link href={archivedMode ? activeConversationsHref(params) : archivedConversationsHref(params)}>
        <span aria-hidden="true">{archivedMode ? "←" : "↺"}</span>
        {archivedMode ? "Back to conversations" : "Archived conversations"}
      </Link>
    </footer>
  </div>;
}

function StructuredMetadata({ value }: { value: unknown }) {
  const data = value as {
    evidence?: Array<{ metricKey: string; label: string; value: string; comparison?: string | null; period?: string }>;
    caveats?: string[];
    recommendations?: string[];
    followUpQuestions?: string[];
    scopeSnapshot?: AiScopeSnapshot;
    sourceDomains?: AiSourceDomain[];
    intent?: AiIntent;
    language?: AiAnswerLanguage;
    temporalSemantics?: AiTemporalSemantics;
  };
  const language = data.language ?? "en";
  const zh = language === "zh";
  const sourceDomains = Array.isArray(data.sourceDomains) ? data.sourceDomains : domainsFromEvidence(data.evidence ?? []);
  const actions = buildAiSourceActions({ domains: sourceDomains, snapshot: data.scopeSnapshot, language });
  return <div className={styles.answerDetails}>
    {data.scopeSnapshot ? <p className={styles.answerScope}><span>{data.temporalSemantics === "SNAPSHOT" ? (zh ? "当前状态" : "Current snapshot") : (zh ? "数据范围" : "Based on")}</span>{aiScopeSummary(data.scopeSnapshot, { language, temporalSemantics: data.temporalSemantics })}</p> : <p className={styles.legacyScope}>{zh ? "这则较早的回答没有保存数据范围。" : "Scope was not recorded for this earlier answer."}</p>}
    {data.evidence?.length ? <section><h3>{zh ? "相关数据" : "Relevant figures"}</h3><div className={styles.evidenceGrid}>{data.evidence.map((item, index) => <div key={`${item.metricKey}-${index}`}><span>{item.label}</span><strong>{item.value}</strong>{item.comparison ? <small>{item.comparison}</small> : null}</div>)}</div></section> : null}
    <AnswerList title={zh ? "需要留意" : "Important context"} items={data.caveats} />
    <AnswerList title={zh ? "下一步检查" : "Next checks"} items={data.recommendations} />
    {actions.length ? <nav className={styles.sourceActions} aria-label={zh ? "来源记录" : "Source records"}>{actions.map((action) => <Link key={action.domain} href={action.href}>{action.label}<span aria-hidden="true">→</span></Link>)}</nav> : null}
  </div>;
}

function AnswerList({ title, items }: { title: string; items?: string[] }) {
  return items?.length ? <section className={styles.answerList}><h3>{title}</h3><ul>{items.map((item) => <li key={item}>{item}</li>)}</ul></section> : null;
}

function domainsFromEvidence(evidence: Array<{ metricKey: string }>): AiSourceDomain[] {
  const keys = new Set(evidence.map((item) => item.metricKey));
  if ([...keys].some((key) => key.startsWith("AP_") || key === "OUTSTANDING_AP")) return ["SUPPLIER_BILLS"];
  if ([...keys].some((key) => key.includes("EMPLOYEE"))) return ["PEOPLE"];
  if ([...keys].some((key) => key.startsWith("APPOINTMENTS_"))) return ["APPOINTMENTS"];
  if ([...keys].some((key) => key.startsWith("PAYMENTS_"))) return ["PAYMENTS"];
  if ([...keys].some((key) => key.includes("STOCK") || key === "TRACKED_PRODUCTS" || key === "INVENTORY_SELLING_VALUE")) return ["INVENTORY"];
  if ([...keys].some((key) => key.includes("SPENDING"))) return ["REPORTS", "EXPENSES"];
  return ["REPORTS"];
}

function conversationHref(id: string, params: SearchParams) { const query = buildContextQuery(params); query.set("conversationId", id); return `/ai?${query}`; }
function newConversationHref(params: SearchParams) { const query = buildContextQuery(params); query.delete("conversationId"); return `/ai?${query}`; }
function archivedConversationsHref(params: SearchParams) { const query = buildContextQuery(params); query.set("view", "archived"); query.delete("conversationId"); return `/ai?${query}`; }
function activeConversationsHref(params: SearchParams) { const query = buildContextQuery(params); query.delete("view"); query.delete("conversationId"); return `/ai?${query}`; }
function rangeHref(range: string, params: SearchParams) { const query = buildContextQuery(params); query.set("range", range); if (range !== "custom") { query.delete("from"); query.delete("to"); } return `/ai?${query}`; }
function buildContextQuery(params: SearchParams) { const query = new URLSearchParams({ range: normalizeAiRange(params.range) }); if (params.from) query.set("from", params.from); if (params.to) query.set("to", params.to); if (params.conversationId) query.set("conversationId", params.conversationId); if (params.view === "archived") query.set("view", "archived"); return query; }

function quotaMessage(
  allowance: Awaited<ReturnType<typeof getAiWorkspace>>["allowance"],
  usageNotice: ReturnType<typeof getAiUsageNotice>,
) {
  if (!allowance.configured) return "Ask Tetamu is not enabled for this business. Contact your Tetamu account administrator to enable it.";
  if (allowance.status === "SUSPENDED") return "Ask Tetamu is temporarily unavailable for this business.";
  if (usageNotice?.kind === "EXHAUSTED") return usageNotice.message;
  return undefined;
}
