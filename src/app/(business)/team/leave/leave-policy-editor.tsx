"use client";

import { useState } from "react";
import { createLeavePolicyVersionAction } from "./actions";
import styles from "./leave.module.css";

export type LeavePolicyEditorValue = {
  id: string;
  name: string;
  payTreatment: string;
  countMode: string;
  balanceTracked: boolean;
  defaultEntitlementDays: number | null;
  underTwoYearsDays: number | null;
  twoToFiveYearsDays: number | null;
  fiveYearsPlusDays: number | null;
  requiresDocument: boolean;
  allowNegativeBalance: boolean;
  statutoryCategory: string | null;
  entitlementPeriodType: string;
  customYearStartMonth: number | null;
  customYearStartDay: number | null;
  prorationMethod: string;
  entitlementRounding: string;
  eligibleEmploymentTypes: string[];
  carryForwardEnabled: boolean;
  carryForwardLimitUnits: number | string | null;
  carryForwardExpiryRule: string;
  carryForwardExpiryValue: string | null;
  consumptionPriority: string;
};

export function LeavePolicyEditor({
  value,
  earliestEffectiveDate,
}: {
  value: LeavePolicyEditorValue;
  earliestEffectiveDate: string;
}) {
  const [payTreatment, setPayTreatment] = useState(value.payTreatment);
  const [balanceTracked, setBalanceTracked] = useState(value.balanceTracked);
  const [serviceBased, setServiceBased] = useState(
    value.underTwoYearsDays !== null
      || value.twoToFiveYearsDays !== null
      || value.fiveYearsPlusDays !== null,
  );
  const [carryForwardEnabled, setCarryForwardEnabled] = useState(value.carryForwardEnabled);
  const [entitlementPeriodType, setEntitlementPeriodType] = useState(value.entitlementPeriodType);

  function choosePayTreatment(next: string) {
    setPayTreatment(next);
    if (next === "UNPAID") setBalanceTracked(false);
  }

  return (
    <form action={createLeavePolicyVersionAction} className={styles.policyEditorForm}>
      <input name="policyId" type="hidden" value={value.id} />

      <div className={styles.policyBasicGrid}>
        <label>
          Changes take effect
          <input
            defaultValue={earliestEffectiveDate}
            min={earliestEffectiveDate}
            name="effectiveFrom"
            required
            type="date"
          />
          <small>Earlier requests, balances and payroll records keep their original policy.</small>
        </label>
        <label>
          Leave name
          <input defaultValue={value.name} maxLength={120} minLength={2} name="name" required />
        </label>
        <label>
          Pay treatment
          <select name="payTreatment" onChange={(event) => choosePayTreatment(event.target.value)} value={payTreatment}>
            <option value="PAID">Paid leave</option>
            <option value="UNPAID">Unpaid leave</option>
          </select>
        </label>
        <label>
          Count leave using
          <select defaultValue={value.countMode} name="countMode">
            <option value="WEEKDAYS">Scheduled workdays</option>
            <option value="CALENDAR_DAYS">Calendar days</option>
          </select>
        </label>
      </div>

      <fieldset className={styles.policySection}>
        <legend>Leave allowance</legend>
        <p>Choose whether employees receive a balance for this leave type.</p>
        <div className={styles.allowanceChoice}>
          <label>
            <input
              checked={balanceTracked}
              disabled={payTreatment === "UNPAID"}
              name="balanceTracked"
              onChange={() => setBalanceTracked(true)}
              type="radio"
              value="on"
            />
            Fixed yearly allowance
          </label>
          <label>
            <input
              checked={!balanceTracked}
              name="balanceTrackedChoice"
              onChange={() => setBalanceTracked(false)}
              type="radio"
              value="none"
            />
            No balance required
          </label>
        </div>
        {balanceTracked ? (
          <label className={styles.compactField}>
            Days per year
            <input
              defaultValue={value.defaultEntitlementDays ?? undefined}
              max="366"
              min="0"
              name="defaultEntitlementDays"
              required
              step="0.5"
              type="number"
            />
          </label>
        ) : (
          <input name="defaultEntitlementDays" type="hidden" value="" />
        )}
      </fieldset>

      <div className={styles.optionGroup}>
        <label>
          <input defaultChecked={value.requiresDocument} name="requiresDocument" type="checkbox" />
          Supporting document required
        </label>
        <label>
          <input defaultChecked={value.allowNegativeBalance} name="allowNegativeBalance" type="checkbox" />
          Allow requests beyond available balance
        </label>
      </div>
      <p className={styles.policyHint}>Requests beyond the balance still require approval and do not automatically become unpaid leave.</p>

      <details className={styles.policyAdvanced}>
        <summary>Advanced policy settings</summary>
        <p>Open only when eligibility, service tiers, proration, rounding or carry-forward rules need to change.</p>

        <div className={styles.policyAdvancedBody}>
          <fieldset className={styles.policySection}>
            <legend>Allowance calculation</legend>
            <div className={styles.allowanceChoice}>
              <label><input checked={!serviceBased} name="allowanceCalculation" onChange={() => setServiceBased(false)} type="radio" value="same" /> Same for everyone</label>
              <label><input checked={serviceBased} name="allowanceCalculation" onChange={() => setServiceBased(true)} type="radio" value="service" /> Based on length of service</label>
            </div>
            {serviceBased ? (
              <div className={styles.threeColumnFields}>
                <label>Under 2 years<input defaultValue={value.underTwoYearsDays ?? value.defaultEntitlementDays ?? undefined} max="366" min="0" name="underTwoYearsDays" step="0.5" type="number" /></label>
                <label>2 to under 5 years<input defaultValue={value.twoToFiveYearsDays ?? value.defaultEntitlementDays ?? undefined} max="366" min="0" name="twoToFiveYearsDays" step="0.5" type="number" /></label>
                <label>5+ years<input defaultValue={value.fiveYearsPlusDays ?? value.defaultEntitlementDays ?? undefined} max="366" min="0" name="fiveYearsPlusDays" step="0.5" type="number" /></label>
              </div>
            ) : null}
          </fieldset>

          <fieldset className={styles.policySection}>
            <legend>Eligible employees</legend>
            <div className={styles.compactChecks}>
              <label><input defaultChecked={value.eligibleEmploymentTypes.includes("FULL_TIME")} name="eligibleEmploymentTypes" type="checkbox" value="FULL_TIME" /> Full time</label>
              <label><input defaultChecked={value.eligibleEmploymentTypes.includes("PART_TIME")} name="eligibleEmploymentTypes" type="checkbox" value="PART_TIME" /> Part time</label>
              <label><input defaultChecked={value.eligibleEmploymentTypes.includes("CONTRACT")} name="eligibleEmploymentTypes" type="checkbox" value="CONTRACT" /> Contract</label>
              <label><input defaultChecked={value.eligibleEmploymentTypes.includes("DAILY")} name="eligibleEmploymentTypes" type="checkbox" value="DAILY" /> Daily paid</label>
              <label><input defaultChecked={value.eligibleEmploymentTypes.includes("HOURLY")} name="eligibleEmploymentTypes" type="checkbox" value="HOURLY" /> Hourly paid</label>
            </div>
            <small>Leave all unchecked when the policy applies to every employment type.</small>
          </fieldset>

          <div className={styles.policyBasicGrid}>
            <label>
              Employees joining during the year
              <select defaultValue={value.prorationMethod} name="prorationMethod">
                <option value="NONE">Receive the full allowance</option>
                <option value="CALENDAR_DAY_RATIO">Prorate from the joining date</option>
              </select>
            </label>
            <label>
              Entitlement period
              <select name="entitlementPeriodType" onChange={(event) => setEntitlementPeriodType(event.target.value)} value={entitlementPeriodType}>
                <option value="CALENDAR_YEAR">Calendar year</option>
                <option value="SERVICE_ANNIVERSARY">Service anniversary</option>
                <option value="CUSTOM_YEAR">Custom year</option>
              </select>
            </label>
            {entitlementPeriodType === "CUSTOM_YEAR" ? (
              <div className={styles.customYearFields}>
                <label>
                  Start month
                  <input defaultValue={value.customYearStartMonth ?? undefined} max="12" min="1" name="customYearStartMonth" required type="number" />
                </label>
                <label>
                  Start day
                  <input defaultValue={value.customYearStartDay ?? undefined} max="31" min="1" name="customYearStartDay" required type="number" />
                </label>
              </div>
            ) : (
              <>
                <input name="customYearStartMonth" type="hidden" value="" />
                <input name="customYearStartDay" type="hidden" value="" />
              </>
            )}
            <label>
              Entitlement rounding
              <select defaultValue={value.entitlementRounding} name="entitlementRounding">
                <option value="NONE">Keep the calculated amount</option>
                <option value="DOWN_TO_HALF_DAY">Round down to half day</option>
                <option value="NEAREST_HALF_DAY">Round to nearest half day</option>
                <option value="UP_TO_HALF_DAY">Round up to half day</option>
              </select>
            </label>
            <label>
              Statutory minimum mapping
              <select defaultValue={value.statutoryCategory ?? ""} name="statutoryCategory">
                <option value="">Company benefit only</option>
                <option value="ANNUAL_LEAVE">Annual leave</option>
                <option value="SICK_LEAVE">Medical leave</option>
                <option value="HOSPITALISATION_LEAVE">Hospitalisation leave</option>
                <option value="MATERNITY_LEAVE">Maternity leave</option>
                <option value="PATERNITY_LEAVE">Paternity leave</option>
              </select>
            </label>
          </div>

          <fieldset className={styles.policySection}>
            <legend>Carry forward</legend>
            <label className={styles.switchLine}>
              <input checked={carryForwardEnabled} name="carryForwardEnabled" onChange={(event) => setCarryForwardEnabled(event.target.checked)} type="checkbox" />
              Carry unused days into the next leave period
            </label>
            {carryForwardEnabled ? (
              <div className={styles.policyBasicGrid}>
                <label>Maximum days<input defaultValue={value.carryForwardLimitUnits ?? undefined} max="366" min="0" name="carryForwardLimitUnits" placeholder="No limit" step="0.5" type="number" /></label>
                <label>
                  Expiry
                  <select defaultValue={value.carryForwardExpiryRule} name="carryForwardExpiryRule">
                    <option value="NO_EXPIRY">Does not expire</option>
                    <option value="DAYS_AFTER_ROLLOVER">Days after rollover</option>
                    <option value="MONTHS_AFTER_ROLLOVER">Months after rollover</option>
                    <option value="FIXED_DATE_IN_DESTINATION_PERIOD">Fixed date in the new period</option>
                  </select>
                </label>
                <label>Expiry value<input defaultValue={value.carryForwardExpiryValue ?? undefined} name="carryForwardExpiryValue" placeholder="For example 90, 3, or 03-31" /></label>
                <label>
                  Use balance from
                  <select defaultValue={value.consumptionPriority} name="consumptionPriority">
                    <option value="EARLIEST_EXPIRY_FIRST">Days expiring first</option>
                    <option value="OLDEST_ENTITLEMENT_FIRST">Oldest allowance first</option>
                  </select>
                </label>
              </div>
            ) : (
              <>
                <input name="carryForwardLimitUnits" type="hidden" value="" />
                <input name="carryForwardExpiryRule" type="hidden" value="NO_EXPIRY" />
                <input name="carryForwardExpiryValue" type="hidden" value="" />
                <input name="consumptionPriority" type="hidden" value={value.consumptionPriority} />
              </>
            )}
          </fieldset>
        </div>
      </details>

      <label>
        Reason for change
        <input maxLength={500} minLength={3} name="reason" placeholder="For example, annual allowance updated for 2027" required />
      </label>
      <button type="submit">Save policy change</button>
    </form>
  );
}
