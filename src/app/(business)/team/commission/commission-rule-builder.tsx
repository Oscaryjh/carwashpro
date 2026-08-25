"use client";

import { useMemo, useState } from "react";
import styles from "./commission.module.css";

type SourceType = "SERVICE" | "PRODUCT" | "PACKAGE_PURCHASE";
type RuleType = "PERCENTAGE" | "FIXED_AMOUNT" | "TIERED_PERCENTAGE";

type Catalog = Record<SourceType, Array<{ id: string; name: string; status: string }>>;
type CategoryCatalog = Record<SourceType, Array<{ id: string; name: string; status: string }>>;

type InitialRule = {
  ruleId: string;
  expectedRevision: number;
  name: string;
  sourceType: SourceType;
  branchId: string | null;
  scope: "ALL" | "CATEGORY" | "ITEM" | "MEMBER";
  scopeId: string | null;
  itemId: string | null;
  ruleType: RuleType;
  basis: "GROSS" | "NET_AFTER_DISCOUNT";
  ratePercent: string;
  fixedAmountRinggit: string;
  tiers: Array<{ fromRinggit: string; ratePercent: string }>;
  priority: number;
  effectiveFrom: string;
  effectiveUntil: string;
};

export function CommissionRuleBuilder({
  action,
  branches,
  catalogs,
  categories,
  initial,
  memberships,
}: {
  action: (formData: FormData) => Promise<void>;
  branches: Array<{ id: string; name: string }>;
  catalogs: Catalog;
  categories: CategoryCatalog;
  initial?: InitialRule;
  memberships: Array<{ id: string; fullName: string; employeeCode: string }>;
}) {
  const editing = Boolean(initial);
  const [sourceType, setSourceType] = useState<SourceType>(initial?.sourceType ?? "SERVICE");
  const [appliesTo, setAppliesTo] = useState<"COMPANY" | "EMPLOYEE">(
    initial?.scope === "MEMBER" ? "EMPLOYEE" : "COMPANY",
  );
  const [itemSelection, setItemSelection] = useState<"ALL" | "CATEGORY" | "SPECIFIC">(
    initial?.scope === "CATEGORY" ? "CATEGORY" : initial && (initial.scope === "ITEM" || initial.itemId) ? "SPECIFIC" : "ALL",
  );
  const [ruleType, setRuleType] = useState<RuleType>(initial?.ruleType ?? "PERCENTAGE");
  const [itemQuery, setItemQuery] = useState("");
  const [hasEndDate, setHasEndDate] = useState(Boolean(initial?.effectiveUntil));
  const [tiers, setTiers] = useState(
    initial?.tiers.length ? initial.tiers : [{ fromRinggit: "0", ratePercent: "" }],
  );

  const visibleItems = catalogs[sourceType].filter((item) => item.name.toLowerCase().includes(itemQuery.trim().toLowerCase()));
  const visibleCategories = categories[sourceType];
  const subject = useMemo(() => sourceLabel(sourceType).toLowerCase(), [sourceType]);

  return (
    <form action={action} className={styles.ruleBuilder}>
      {initial ? (
        <>
          <input name="ruleId" type="hidden" value={initial.ruleId} />
          <input name="expectedRevision" type="hidden" value={initial.expectedRevision} />
          <input name="name" type="hidden" value={initial.name} />
          <input name="sourceType" type="hidden" value={initial.sourceType} />
          <input name="branchId" type="hidden" value={initial.branchId ?? ""} />
          <input name="scope" type="hidden" value={initial.scope} />
          <input name="scopeId" type="hidden" value={initial.scopeId ?? ""} />
          <input name="itemId" type="hidden" value={initial.itemId ?? ""} />
          <input name="priority" type="hidden" value={initial.priority} />
        </>
      ) : null}

      {!editing ? (
        <div className={styles.builderColumns}>
          <fieldset className={styles.builderStep}>
            <legend><span>1</span> What earns commission?</legend>
            <div className={styles.choiceGrid}>
              {(["SERVICE", "PRODUCT", "PACKAGE_PURCHASE"] as const).map((value) => (
                <label className={styles.choiceCard} key={value}>
                  <input
                    checked={sourceType === value}
                    name="sourceType"
                    onChange={() => { setSourceType(value); setItemSelection("ALL"); }}
                    type="radio"
                    value={value}
                  />
                  <span>{sourceLabel(value)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.builderStep}>
            <legend><span>2</span> Who does this rate apply to?</legend>
            <div className={styles.choiceGrid}>
              <label className={styles.choiceCard}>
                <input checked={appliesTo === "COMPANY"} name="appliesTo" onChange={() => setAppliesTo("COMPANY")} type="radio" value="COMPANY" />
                <span>Company default</span>
              </label>
              <label className={styles.choiceCard}>
                <input checked={appliesTo === "EMPLOYEE"} name="appliesTo" onChange={() => { setAppliesTo("EMPLOYEE"); if (itemSelection === "CATEGORY") setItemSelection("ALL"); }} type="radio" value="EMPLOYEE" />
                <span>Specific employee</span>
              </label>
            </div>
            {appliesTo === "EMPLOYEE" ? (
              <label className={styles.builderField}>Employee
                <select name="membershipId" required>
                  <option value="">Select an employee</option>
                  {memberships.map((member) => <option key={member.id} value={member.id}>{member.fullName} · {member.employeeCode}</option>)}
                </select>
              </label>
            ) : null}
          </fieldset>
        </div>
      ) : (
        <div className={styles.editContext}>
          <strong>Change this rate</strong>
          <span>The earlier version remains attached to completed commission statements.</span>
        </div>
      )}

      {!editing ? (
        <fieldset className={styles.builderStep}>
          <legend><span>3</span> Which {subject}?</legend>
          <div className={styles.inlineChoices}>
            <label><input checked={itemSelection === "ALL"} name="itemSelection" onChange={() => setItemSelection("ALL")} type="radio" value="ALL" /> All {subject}</label>
            {appliesTo === "COMPANY" ? <label><input checked={itemSelection === "CATEGORY"} name="itemSelection" onChange={() => setItemSelection("CATEGORY")} type="radio" value="CATEGORY" /> One category</label> : null}
            <label><input checked={itemSelection === "SPECIFIC"} name="itemSelection" onChange={() => setItemSelection("SPECIFIC")} type="radio" value="SPECIFIC" /> Specific {subject}</label>
          </div>
          {itemSelection === "CATEGORY" ? (
            <label className={styles.builderField}>Category
              <select name="categoryId" required>
                <option value="">Select a category</option>
                {visibleCategories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.status !== "ACTIVE" ? " · Archived" : ""}</option>)}
              </select>
            </label>
          ) : null}
          {itemSelection === "SPECIFIC" ? (
            <div>
              <label className={styles.builderField}>Search {subject}<input onChange={(event) => setItemQuery(event.target.value)} placeholder={`Search ${subject}`} type="search" value={itemQuery} /></label>
              <div className={styles.itemPicker}>
              {visibleItems.length ? visibleItems.map((item) => (
                <label key={item.id}>
                  <input name="itemIds" type="checkbox" value={item.id} />
                  <span>{item.name}</span>
                  {item.status !== "ACTIVE" ? <small>Archived</small> : null}
                </label>
              )) : <p>No matching {subject}.</p>}
              </div>
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className={styles.builderStep}>
        <legend><span>{editing ? "1" : "4"}</span> How is commission calculated?</legend>
        <div className={styles.inlineChoices}>
          <label><input checked={ruleType === "PERCENTAGE"} name="ruleType" onChange={() => setRuleType("PERCENTAGE")} type="radio" value="PERCENTAGE" /> Percentage</label>
          <label><input checked={ruleType === "FIXED_AMOUNT"} name="ruleType" onChange={() => setRuleType("FIXED_AMOUNT")} type="radio" value="FIXED_AMOUNT" /> Fixed amount per item</label>
          <label><input checked={ruleType === "TIERED_PERCENTAGE"} name="ruleType" onChange={() => setRuleType("TIERED_PERCENTAGE")} type="radio" value="TIERED_PERCENTAGE" /> Tiered percentage</label>
        </div>
        {ruleType === "PERCENTAGE" ? (
          <label className={styles.rateField}>Commission rate<div><input defaultValue={initial?.ratePercent} max="100" min="0" name="ratePercent" required step="0.01" type="number" /><span>%</span></div></label>
        ) : null}
        {ruleType === "FIXED_AMOUNT" ? (
          <label className={styles.rateField}>Commission per item<div><span>RM</span><input defaultValue={initial?.fixedAmountRinggit} min="0" name="fixedAmountRinggit" required step="0.01" type="number" /></div></label>
        ) : null}
        {ruleType === "TIERED_PERCENTAGE" ? (
          <div className={styles.tierBuilder}>
            {tiers.map((tier, index) => (
              <div className={styles.tierRow} key={index}>
                <strong>Tier {index + 1}</strong>
                <label>Sales from<div><span>RM</span><input min="0" name="tierFromRinggit" onChange={(event) => setTiers((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, fromRinggit: event.target.value } : row))} required step="0.01" value={tier.fromRinggit} /></div></label>
                <label>Until<div className={styles.tierLimit}>{tierUpperLimit(tiers, index)}</div></label>
                <label>Commission<div><input max="100" min="0" name="tierRatePercent" onChange={(event) => setTiers((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ratePercent: event.target.value } : row))} required step="0.01" value={tier.ratePercent} /><span>%</span></div></label>
                {index ? <button aria-label={`Remove tier ${index + 1}`} className={styles.removeTier} onClick={() => setTiers((current) => current.filter((_, rowIndex) => rowIndex !== index))} type="button">Remove</button> : null}
              </div>
            ))}
            <button className={styles.secondaryButton} onClick={() => setTiers((current) => [...current, { fromRinggit: "", ratePercent: "" }])} type="button">+ Add tier</button>
            <p>The rate for the highest reached tier applies to the whole commission period.</p>
          </div>
        ) : null}
      </fieldset>

      <fieldset className={styles.builderStep}>
        <legend><span>{editing ? "2" : "5"}</span> When and how should it apply?</legend>
        <div className={styles.builderColumns}>
          <label className={styles.builderField}>Calculate commission from
            <select defaultValue={initial?.basis ?? "NET_AFTER_DISCOUNT"} name="basis">
              <option value="NET_AFTER_DISCOUNT">Final sale amount after discounts</option>
              <option value="GROSS">Original price before discounts</option>
            </select>
          </label>
          <label className={styles.builderField}>Effective from<input defaultValue={initial?.effectiveFrom} name="effectiveFrom" required type="date" /></label>
        </div>
        <label className={styles.endToggle}><input checked={hasEndDate} name="hasEndDate" onChange={(event) => setHasEndDate(event.target.checked)} type="checkbox" /> End this rate on a specific date</label>
        {hasEndDate ? <label className={styles.builderField}>End date<input defaultValue={initial?.effectiveUntil} name="effectiveUntil" required type="date" /></label> : null}
        {editing ? <label className={styles.builderField}>Why is the rate changing?<input maxLength={500} minLength={5} name="reason" placeholder="For example, annual rate review" required /></label> : null}
      </fieldset>

      {!editing && branches.length > 1 ? (
        <details className={styles.advancedFields}>
          <summary>Advanced · Limit to one branch</summary>
          <label className={styles.builderField}>Branch<select name="branchId"><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        </details>
      ) : null}

      <div className={styles.builderFooter}>
        <p>Saving a change creates a new effective version. Approved commission history stays unchanged.</p>
        <button type="submit">{editing ? "Save new rate version" : "Save commission rule"}</button>
      </div>
    </form>
  );
}

function sourceLabel(value: SourceType) {
  return value === "SERVICE" ? "Services" : value === "PRODUCT" ? "Products" : "Packages";
}

function tierUpperLimit(tiers: Array<{ fromRinggit: string; ratePercent: string }>, index: number) {
  const nextValue = tiers[index + 1]?.fromRinggit.trim();
  if (!nextValue) return index === tiers.length - 1 ? "No upper limit" : "Set the next tier start";
  const nextStart = Number(nextValue);
  if (!Number.isFinite(nextStart)) return "No upper limit";
  return `RM ${Math.max(0, nextStart - 0.01).toFixed(2)}`;
}
