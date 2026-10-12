import Link from "next/link";
import { AiBusinessChat } from "@/components/ai-business-chat";
import { AskTetamuChatFrame, AskTetamuNewChat } from "@/components/ask-tetamu-chat-frame";
import { getAskTetamuViewState } from "@/components/ask-tetamu-view-state";
import { hasBusinessCapability } from "@/lib/business-groups/business-access";
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
import { canSendOwnerPilot } from "@/lib/ai/pilot-access";
import { prisma } from "@/lib/prisma";
import type { AiAnswerLanguage, AiIntent, AiTemporalSemantics } from "@/lib/ai/intent";

type SearchParams = { conversationId?: string; range?: string; from?: string; to?: string; view?: string };
type Props = { searchParams: Promise<SearchParams> };

export default async function AiPage({ searchParams }: Props) {
  const context = await requireBusinessUserForModule("AI", "VIEW_AI_ANALYSIS");
  if (context.access.source === "DIRECT_BUSINESS") assertStaffPermission(context.user, "AI_ANALYSIS_VIEW");
  const params = await searchParams;
  const showArchived = params.view === "archived";
  const [workspace, business, pilotOwner] = await Promise.all([
    getAiWorkspace({ userId: context.user.userId, businessId: context.businessId, archived: showArchived }),
    prisma.business.findUniqueOrThrow({ where: { id: context.businessId }, select: { name: true } }),
    canSendOwnerPilot(context.user.userId, context.businessId),
  ]);
  const visibleConversations = workspace.conversations;
  const current = params.conversationId
    ? visibleConversations.find((item) => item.id === params.conversationId) ?? null
    : null;
  const range = normalizeAiRange(params.range);
  const allowance = workspace.allowance;
  const usageNotice = getAiUsageNotice(allowance);
  const viewState = getAskTetamuViewState({ ...allowance, canUse: hasBusinessCapability(context.access, "USE_AI_ANALYSIS"), pilotAccess: pilotOwner ? "owner" : "restricted" });
  const sidebar = (
    <ConversationList
      currentId={current?.id}
      conversations={visibleConversations}
      params={{ ...params, range }}
      archivedMode={showArchived}
      canAsk={viewState.canAsk}
    />
  );

  return (
    <AskTetamuChatFrame sidebar={sidebar} header={
      <header className={styles.chatHeader}>
        <div><h1>Ask Tetamu</h1><p>{business.name}</p></div>
        <div className={styles.chatContext}><span className={styles.modeBadge}>{viewState.label}</span>
          {allowance.configured ? <details className={styles.periodPicker}>
            <summary aria-label="Question period">{aiRangeLabel(range)} <span aria-hidden="true">▾</span></summary>
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
              {showArchived ? <input type="hidden" name="view" value="archived" /> : null}
              <label><span>From</span><input type="date" name="from" defaultValue={params.from} required /></label>
              <label><span>To</span><input type="date" name="to" defaultValue={params.to} required /></label>
              <button type="submit">Apply</button>
            </form> : null}
          </details> : null}
        </div>
      </header>
    }>
      <AiBusinessChat
        presentation="conversation"
        scopeType="BUSINESS"
        requestStorageKey={`tetamu-ai-request:${context.user.userId}:${context.businessId}`}
        conversationId={current?.id}
        messageCount={current?.messages.length ?? 0}
        range={range}
        from={params.from}
        to={params.to}
        quotaBlocked={!viewState.canAsk || showArchived}
        disabledTitle={showArchived ? "Archived conversation" : viewState.label}
        disabledReason={showArchived ? "Restore a conversation to continue asking questions in it." : usageNotice?.kind === "EXHAUSTED" && viewState.label === "Monthly limit reached" ? usageNotice?.message : viewState.reason}
        usageWarning={usageNotice?.kind === "LOW" ? usageNotice.message : undefined}
        remainingRequests={allowance.remainingRequests}
        showSuggestions={viewState.canAsk && !showArchived && (!current || current.messages.length === 0)}
        emptyStateNotice={!allowance.configured}
        emptyTitle={!allowance.configured ? viewState.label : showArchived ? "Archived conversations" : undefined}
        emptyDescription={!allowance.configured ? viewState.reason : showArchived ? "Choose a conversation to review its history." : undefined}
        history={current && current.messages.length > 0 ? (
              <div className={styles.history}>
                {current.messages.map((message) => (
                  <article className={`${styles.message} ${message.role === "USER" ? styles.userMessage : styles.assistantMessage}`} key={message.id}>
                    <header><strong>{message.role === "USER" ? "You" : "Ask Tetamu"}</strong><time dateTime={message.createdAt.toISOString()}>{message.createdAt.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</time></header>
                    <p>{message.content}</p>
                    {message.role === "ASSISTANT" && message.structuredMetadata ? <StructuredMetadata value={message.structuredMetadata} /> : null}
                  </article>
                ))}
              </div>
            ) : undefined}
        footer={<>
            {showArchived && current ? (
              <section className={styles.archivedConversationNotice}>
                <div><strong>{current ? "This conversation is archived" : "Archive view"}</strong><p>{current ? "Restore it to continue the conversation." : "Archived conversations are retained until you restore them."}</p></div>
                <RestoreConversationButton conversationId={current.id} />
              </section>
            ) : null}
            <p className={styles.readOnlyNotice}>Ask Tetamu only reads business data. Verify important figures against source reports.</p>
        </>}
      />
    </AskTetamuChatFrame>
  );
}

function ConversationList({ currentId, conversations, params, archivedMode, canAsk }: {
  currentId?: string;
  conversations: Awaited<ReturnType<typeof getAiWorkspace>>["conversations"];
  params: SearchParams;
  archivedMode: boolean;
  canAsk: boolean;
}) {
  return <div className={styles.conversationList}>
    <div className={styles.sidebarHeading}><div><h2>{archivedMode ? "Archived" : "Conversations"}</h2><small>{archivedMode ? "Removed from your list" : "Recent"}</small></div>{archivedMode || !canAsk ? null : <AskTetamuNewChat href={newConversationHref(params)} />}</div>
    <nav aria-label="Ask Tetamu conversations">
      {conversations.length ? conversations.map((conversation) => {
        const title = conversation.title ?? "Business question";
        return <div className={styles.conversationRow} key={conversation.id}>
          <Link aria-current={currentId === conversation.id ? "page" : undefined} className={currentId === conversation.id ? styles.activeConversation : ""} href={conversationHref(conversation.id, params)}><strong>{title}</strong><small>{conversation.updatedAt.toLocaleString("en-MY", { dateStyle: "medium", timeStyle: "short" })}</small></Link>
          {archivedMode ? <RestoreConversationButton conversationId={conversation.id} iconOnly /> : <ArchiveConversationButton conversationId={conversation.id} title={title} />}
        </div>;
      }) : <div className={styles.emptySidebar}><strong>{archivedMode ? "No archived conversations" : "No conversations yet"}</strong></div>}
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
