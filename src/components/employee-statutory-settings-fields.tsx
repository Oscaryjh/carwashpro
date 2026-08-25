"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./employee-profile-shell.module.css";

type StatutoryNationality =
  "MALAYSIAN" | "PERMANENT_RESIDENT" | "NON_MALAYSIAN";

type SocsoCategory = "FIRST" | "SECOND";

type EmployeeStatutorySettingsFieldsProps = {
  employeeAge: number | null;
  eisEnabled: boolean;
  eisPreviouslyContributed: boolean;
  epfEnabled: boolean;
  epfMemberBeforeAug1998: boolean;
  nationality: StatutoryNationality | null;
  profileEditHref: string;
  socsoCategory: SocsoCategory | null;
  socsoEnabled: boolean;
};

export function EmployeeStatutorySettingsFields({
  employeeAge,
  eisEnabled: initialEisEnabled,
  eisPreviouslyContributed,
  epfEnabled: initialEpfEnabled,
  epfMemberBeforeAug1998,
  nationality: initialNationality,
  profileEditHref,
  socsoCategory,
  socsoEnabled,
}: EmployeeStatutorySettingsFieldsProps) {
  const [nationality, setNationality] = useState(initialNationality ?? "");
  const [epfEnabled, setEpfEnabled] = useState(initialEpfEnabled);
  const [socsoIncluded, setSocsoIncluded] = useState(socsoEnabled);
  const [selectedSocsoCategory, setSelectedSocsoCategory] = useState(
    socsoCategory ?? "",
  );
  const [eisEnabled, setEisEnabled] = useState(initialEisEnabled);

  const showHistoricEpfQuestion = epfEnabled && nationality === "NON_MALAYSIAN";
  const showHistoricEisQuestion =
    eisEnabled && employeeAge !== null && employeeAge >= 57 && employeeAge < 60;

  return (
    <>
      <section className={styles.statutoryFormSection}>
        <div className={styles.statutorySectionHeading}>
          <span aria-hidden="true">1</span>
          <div>
            <h3>Employee classification</h3>
            <p>Used to apply the correct statutory rules.</p>
          </div>
        </div>
        <div className={styles.statutoryClassificationGrid}>
          <label>
            <span>Nationality</span>
            <select
              name="statutoryNationality"
              onChange={(event) => setNationality(event.target.value)}
              value={nationality}
            >
              <option value="">Not configured</option>
              <option value="MALAYSIAN">Malaysian</option>
              <option value="PERMANENT_RESIDENT">Permanent resident</option>
              <option value="NON_MALAYSIAN">Non-Malaysian</option>
            </select>
          </label>
          <label>
            <span>SOCSO coverage category</span>
            <select
              aria-describedby="socso-category-guidance"
              name="socsoCategory"
              onChange={(event) => {
                const nextCategory = event.target.value;
                setSelectedSocsoCategory(nextCategory);

                if (nextCategory) {
                  setSocsoIncluded(true);
                }
              }}
              value={selectedSocsoCategory}
            >
              <option value="">Not set</option>
              <option value="FIRST">Standard coverage</option>
              <option value="SECOND">Employment injury only</option>
            </select>
            <small
              className={styles.statutoryFieldHint}
              id="socso-category-guidance"
            >
              {socsoCategoryHelp(selectedSocsoCategory)}
            </small>
          </label>
        </div>
      </section>

      <section className={styles.statutoryFormSection}>
        <div className={styles.statutorySectionHeading}>
          <span aria-hidden="true">2</span>
          <div>
            <h3>Statutory schemes</h3>
            <p>
              Turn on the schemes payroll should calculate for this employee.
            </p>
          </div>
        </div>
        <div className={styles.statutorySchemeList}>
          <SchemeCard
            checked={epfEnabled}
            description="Retirement contribution through Kumpulan Wang Simpanan Pekerja."
            shortCode="EPF"
            label="EPF / KWSP"
            name="epfEnabled"
            onChange={setEpfEnabled}
          >
            {showHistoricEpfQuestion ? (
              <ConditionalQuestion
                defaultChecked={epfMemberBeforeAug1998}
                description="For non-Malaysian employees only. This selects the correct foreign-worker contribution schedule."
                label="Registered with EPF before 1 Aug 1998"
                name="epfMemberBeforeAug1998"
              />
            ) : null}
          </SchemeCard>

          <SchemeCard
            checked={socsoIncluded}
            description="Employment injury and invalidity protection through PERKESO."
            shortCode="SOCSO"
            label="SOCSO / PERKESO"
            name="socsoEnabled"
            onChange={(checked) => {
              setSocsoIncluded(checked);

              if (!checked) {
                setSelectedSocsoCategory("");
              }
            }}
          />

          <SchemeCard
            checked={eisEnabled}
            description="Employment insurance for eligible employees below age 60."
            shortCode="EIS"
            label="EIS / SIP"
            name="eisEnabled"
            onChange={setEisEnabled}
          >
            {showHistoricEisQuestion ? (
              <ConditionalQuestion
                defaultChecked={eisPreviouslyContributed}
                description="Turn this on only if the employee contributed to EIS before turning 57."
                label="Contributed to EIS before age 57"
                name="eisPreviouslyContributed"
              />
            ) : eisEnabled && employeeAge === null ? (
              <div className={styles.statutoryMissingDetail}>
                <span>
                  <strong>Date of birth needed</strong>
                  <small>
                    Add it in Profile so EIS eligibility can be checked
                    automatically.
                  </small>
                </span>
                <Link href={profileEditHref}>Add date of birth</Link>
              </div>
            ) : null}
          </SchemeCard>
        </div>
        <p className={styles.statutorySchemeFootnote}>
          These switches control payroll calculations. They do not register the
          employee with EPF, SOCSO or EIS.
        </p>
      </section>
    </>
  );
}

function SchemeCard({
  checked,
  children,
  description,
  shortCode,
  label,
  name,
  onChange,
}: {
  checked: boolean;
  children?: React.ReactNode;
  description: string;
  shortCode: string;
  label: string;
  name: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <article className={styles.statutorySchemeCard} data-enabled={checked}>
      <label className={styles.statutorySchemeToggle}>
        <input
          checked={checked}
          name={name}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span aria-hidden="true" className={styles.statutorySchemeIcon}>
          {shortCode}
        </span>
        <span className={styles.statutorySchemeCopy}>
          <span className={styles.statutorySchemeTitle}>
            <strong>{label}</strong>
            <small>{checked ? "Included" : "Not included"}</small>
          </span>
          <small>{description}</small>
        </span>
        <span aria-hidden="true" className={styles.statutorySwitch} />
      </label>
      {children}
    </article>
  );
}

function socsoCategoryHelp(category: string) {
  if (category === "FIRST") {
    return "Standard coverage selected. SOCSO is included automatically; employer and employee contribute.";
  }

  if (category === "SECOND") {
    return "Employment injury only selected. SOCSO is included automatically; there is no employee deduction.";
  }

  return "Choose a category to include SOCSO automatically, based on age and contribution history.";
}

function ConditionalQuestion({
  defaultChecked,
  description,
  label,
  name,
}: {
  defaultChecked: boolean;
  description: string;
  label: string;
  name: string;
}) {
  return (
    <label className={styles.statutoryConditionalQuestion}>
      <input defaultChecked={defaultChecked} name={name} type="checkbox" />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
