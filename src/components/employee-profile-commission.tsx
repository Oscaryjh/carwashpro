"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { EmployeeCommissionSectionData } from "@/lib/team/employee-profile-commission-read";
import styles from "./employee-profile-commission.module.css";

const sources = [
  { key: "SERVICE", label: "Services" },
  { key: "PRODUCT", label: "Products" },
  { key: "PACKAGE_PURCHASE", label: "Packages" },
] as const;

type SourceType = (typeof sources)[number]["key"];
type RuleType = "PERCENTAGE" | "FIXED_AMOUNT";
type Editor =
  | { type: "default"; sourceType: SourceType }
  | { type: "item"; catalogItem: string };

export function EmployeeProfileCommission({
  action,
  itemAction,
  canManage,
  data,
  membershipId,
}: {
  action: (formData: FormData) => Promise<void>;
  itemAction: (formData: FormData) => Promise<void>;
  canManage: boolean;
  data: EmployeeCommissionSectionData;
  membershipId: string;
}) {
  const latest = data.statements[0] ?? null;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [ruleType, setRuleType] = useState<RuleType>("PERCENTAGE");
  const [rate, setRate] = useState("");

  useEffect(() => {
    if (!editor) return;
    const onKeyDown = (event: KeyboardEvent) =>
      event.key === "Escape" && setEditor(null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editor]);

  function openDefaultEditor(sourceType: SourceType) {
    const override = data.overrides.find(
      (item) => item.sourceType === sourceType,
    );
    setRuleType(editableRuleType(override?.revision.ruleType));
    setRate(override ? rateInputValue(override.revision) : "");
    setEditor({ type: "default", sourceType });
  }

  function openItemEditor(catalogItem = "") {
    const [sourceType, itemId] = catalogItem.split(":");
    const override = data.itemOverrides.find(
      (item) =>
        item.sourceType === sourceType && item.revision.itemId === itemId,
    );
    setRuleType(editableRuleType(override?.revision.ruleType));
    setRate(override ? rateInputValue(override.revision) : "");
    setEditor({ type: "item", catalogItem });
  }

  return (
    <div className={styles.section}>
      <section className={styles.overview}>
        <div className={styles.overviewCopy}>
          <span className={styles.eyebrow}>COMMISSION</span>
          <h2>Employee commission</h2>
          <p>
            Company rates are used automatically unless this employee has a
            personal rate.
          </p>
        </div>
        <div className={styles.overviewMeta}>
          <div className={styles.summaryPills}>
            <SummaryPill
              label="Personal rates"
              value={String(data.overrides.length)}
            />
            <SummaryPill
              label="Special item rates"
              value={String(data.itemOverrides.length)}
            />
            {latest ? (
              <SummaryPill
                label="Latest earned"
                value={money(latest.finalCommissionCents)}
              />
            ) : null}
          </div>
          <Link className={styles.textLink} href="/team/commission">
            Company commission settings
          </Link>
        </div>
      </section>

      <div className={styles.workspace}>
        <section className={`${styles.panel} ${styles.categoryPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <h2>Category rates</h2>
              <p>
                Set the usual commission for services, products and packages.
              </p>
            </div>
          </div>
          <div className={styles.defaultGrid}>
            {sources.map((source) => {
              const override = data.overrides.find(
                (item) => item.sourceType === source.key,
              );
              return (
                <article className={styles.defaultCard} key={source.key}>
                  <div className={styles.rateHeader}>
                    <div className={styles.categoryIdentity}>
                      <CategoryMark sourceType={source.key} />
                      <div>
                        <strong>{source.label}</strong>
                        <span>
                          {override ? "Personal employee rate" : "Company rate"}
                        </span>
                      </div>
                    </div>
                    <span
                      className={styles.badge}
                      data-tone={override ? "personal" : "company"}
                    >
                      {override ? "Personal" : "Company"}
                    </span>
                  </div>
                  <div className={styles.defaultRate}>
                    {override
                      ? formatRate(override.revision)
                      : "Use company rate"}
                  </div>
                  {canManage ? (
                    <button
                      className={styles.cardButton}
                      onClick={() => openDefaultEditor(source.key)}
                      type="button"
                    >
                      Change rate
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.itemPanel}`}>
          <div className={styles.panelHeading}>
            <div>
              <h2>Special item rates</h2>
              <p>
                See every service, product or package with a different rate for
                this employee.
              </p>
            </div>
            {canManage &&
            data.catalogItems.length &&
            data.itemOverrides.length ? (
              <button
                className={styles.compactButton}
                onClick={() => openItemEditor()}
                type="button"
              >
                + Add special rate
              </button>
            ) : null}
          </div>
          {data.itemOverrides.length ? (
            <div className={styles.itemList}>
              <div className={styles.itemListHeader} aria-hidden="true">
                <span>Item</span>
                <span>Special commission</span>
                <span>Action</span>
              </div>
              {data.itemOverrides.map((override) => {
                const catalogItem = `${override.sourceType}:${override.revision.itemId ?? ""}`;
                return (
                  <div className={styles.itemRow} key={override.id}>
                    <div className={styles.itemIdentity}>
                      <span className={styles.itemIcon}>
                        {sourceInitial(override.sourceType)}
                      </span>
                      <div>
                        <strong>{override.itemName}</strong>
                        <span>{sourceLabel(override.sourceType)}</span>
                      </div>
                    </div>
                    <strong className={styles.itemRate}>
                      {formatRate(override.revision)}
                    </strong>
                    {canManage ? (
                      <button
                        className={styles.changeButton}
                        onClick={() => openItemEditor(catalogItem)}
                        type="button"
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyState}>
              <span>No special item rates</span>
              <p>
                Every service, product and package currently uses its category
                rate.
              </p>
              {canManage && data.catalogItems.length ? (
                <button
                  className={styles.primaryButton}
                  onClick={() => openItemEditor()}
                  type="button"
                >
                  + Add special rate
                </button>
              ) : null}
            </div>
          )}
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeading}>
          <div>
            <h2>Commission history</h2>
            <p>Final commission from completed calculation periods.</p>
          </div>
        </div>
        {data.statements.length ? (
          <div className={styles.historyList}>
            {data.statements.map((statement) => (
              <div className={styles.historyRow} key={statement.id}>
                <div>
                  <strong>
                    {formatPeriod(
                      statement.period.earnedPeriodStart,
                      statement.period.earnedPeriodEnd,
                    )}
                  </strong>
                  <span>{formatStatus(statement.status)}</span>
                </div>
                <HistoryAmount
                  label="Eligible sales"
                  value={money(statement.eligibleSalesCents)}
                />
                <HistoryAmount
                  accent
                  label="Commission"
                  value={money(statement.finalCommissionCents)}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <span>No commission history yet</span>
            <p>Completed periods will appear here automatically.</p>
          </div>
        )}
      </section>

      {editor?.type === "default" ? (
        <CommissionModal
          onClose={() => setEditor(null)}
          title={`Change ${sourceLabel(editor.sourceType).toLowerCase()} rate`}
        >
          <form action={action} className={styles.modalForm}>
            <input name="membershipId" type="hidden" value={membershipId} />
            <input name="sourceType" type="hidden" value={editor.sourceType} />
            <RateFields
              rate={rate}
              ruleType={ruleType}
              setRate={setRate}
              setRuleType={setRuleType}
            />
            <ModalActions close={() => setEditor(null)} label="Save rate" />
          </form>
        </CommissionModal>
      ) : null}

      {editor?.type === "item" ? (
        <CommissionModal
          onClose={() => setEditor(null)}
          title={
            editor.catalogItem ? "Change special rate" : "Add special rate"
          }
        >
          <form action={itemAction} className={styles.modalForm}>
            <input name="membershipId" type="hidden" value={membershipId} />
            <label className={styles.field}>
              <span>Service, product or package</span>
              <select
                name="catalogItem"
                onChange={(event) => openItemEditor(event.target.value)}
                required
                value={editor.catalogItem}
              >
                <option disabled value="">
                  Select an item
                </option>
                {sources.map((source) => {
                  const items = data.catalogItems.filter(
                    (item) => item.sourceType === source.key,
                  );
                  return items.length ? (
                    <optgroup key={source.key} label={source.label}>
                      {items.map((item) => (
                        <option
                          key={`${item.sourceType}:${item.id}`}
                          value={`${item.sourceType}:${item.id}`}
                        >
                          {item.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
              </select>
            </label>
            <RateFields
              rate={rate}
              ruleType={ruleType}
              setRate={setRate}
              setRuleType={setRuleType}
            />
            <ModalActions
              close={() => setEditor(null)}
              label="Save special rate"
            />
          </form>
        </CommissionModal>
      ) : null}
    </div>
  );
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.summaryPill}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function CategoryMark({ sourceType }: { sourceType: SourceType }) {
  const mark =
    sourceType === "SERVICE" ? "%" : sourceType === "PRODUCT" ? "$" : "P";
  return (
    <span className={styles.categoryMark} data-source={sourceType}>
      {mark}
    </span>
  );
}
function HistoryAmount({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={styles.historyAmount} data-accent={accent || undefined}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function ModalActions({ close, label }: { close: () => void; label: string }) {
  return (
    <div className={styles.modalActions}>
      <button className={styles.secondaryButton} onClick={close} type="button">
        Cancel
      </button>
      <button className={styles.primaryButton} type="submit">
        {label}
      </button>
    </div>
  );
}

function CommissionModal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div
      aria-label={title}
      aria-modal="true"
      className={styles.modalBackdrop}
      onMouseDown={onClose}
      role="dialog"
    >
      <section
        className={styles.modalCard}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.modalHeader}>
          <div>
            <span className={styles.eyebrow}>PERSONAL COMMISSION</span>
            <h2>{title}</h2>
          </div>
          <button
            aria-label="Close"
            className={styles.closeButton}
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </div>
        <p className={styles.modalHint}>
          This rate applies only to this employee and takes priority over the
          company rule.
        </p>
        {children}
      </section>
    </div>
  );
}

function RateFields({
  rate,
  ruleType,
  setRate,
  setRuleType,
}: {
  rate: string;
  ruleType: RuleType;
  setRate: (value: string) => void;
  setRuleType: (value: RuleType) => void;
}) {
  return (
    <div className={styles.rateFields}>
      <label className={styles.field}>
        <span>Rate type</span>
        <select
          name="ruleType"
          onChange={(event) => setRuleType(event.target.value as RuleType)}
          value={ruleType}
        >
          <option value="PERCENTAGE">Percentage</option>
          <option value="FIXED_AMOUNT">Fixed amount per item</option>
        </select>
      </label>
      <label className={styles.field}>
        <span>Rate</span>
        <div className={styles.rateInput}>
          <input
            min="0"
            name="rate"
            onChange={(event) => setRate(event.target.value)}
            placeholder={ruleType === "PERCENTAGE" ? "e.g. 15" : "e.g. 10.00"}
            required
            step="0.01"
            type="number"
            value={rate}
          />
          <span>{ruleType === "PERCENTAGE" ? "%" : "MYR"}</span>
        </div>
      </label>
    </div>
  );
}

function rateInputValue(
  revision: EmployeeCommissionSectionData["overrides"][number]["revision"],
) {
  return revision.ruleType === "PERCENTAGE"
    ? String((revision.rateBasisPoints ?? 0) / 100)
    : ((revision.fixedAmountCents ?? 0) / 100).toFixed(2);
}

function editableRuleType(value: string | undefined): RuleType {
  return value === "FIXED_AMOUNT" ? "FIXED_AMOUNT" : "PERCENTAGE";
}
function formatRate(
  revision: EmployeeCommissionSectionData["overrides"][number]["revision"],
) {
  return revision.ruleType === "PERCENTAGE"
    ? `${((revision.rateBasisPoints ?? 0) / 100).toFixed(2).replace(/\.00$/, "")}%`
    : `${money(revision.fixedAmountCents ?? 0)} / item`;
}
function money(cents: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
  }).format(cents / 100);
}
function formatDate(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kuching",
  }).format(value);
}
function formatPeriod(start: Date, end: Date) {
  return `${formatDate(start)} – ${formatDate(end)}`;
}
function formatStatus(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
function sourceLabel(value: string) {
  return (
    sources.find((source) => source.key === value)?.label.replace(/s$/, "") ??
    value
  );
}
function sourceInitial(value: string) {
  return sourceLabel(value).slice(0, 1).toUpperCase();
}
