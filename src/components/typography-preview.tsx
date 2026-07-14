"use client";

import { useState } from "react";
import styles from "./typography-preview.module.css";

type TypographyOption = "clean" | "friendly" | "compact";

const typographyOptions: Array<{
  id: TypographyOption;
  name: string;
  label: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    id: "clean",
    name: "Clean Professional",
    label: "Balanced",
    description: "Clear hierarchy with lighter body text and restrained emphasis.",
    recommended: true,
  },
  {
    id: "friendly",
    name: "Modern Friendly",
    label: "Approachable",
    description: "Softer letterforms for a warmer retail and service experience.",
  },
  {
    id: "compact",
    name: "Compact Operational",
    label: "Data focused",
    description: "Tighter typography for tables, numbers, and repeated POS work.",
  },
];

const jobs = [
  { customer: "OSCAR YONG", vehicle: "SAB9118G", status: "In Progress", amount: "RM25.00" },
  { customer: "陈美玲", vehicle: "SAA2038K", status: "Ready", amount: "RM40.00" },
  { customer: "ISAAC LIEW", vehicle: "SAB1G", status: "Paid", amount: "RM18.00" },
];

export function TypographyPreview() {
  const [selectedOption, setSelectedOption] = useState<TypographyOption>("clean");
  const selected = typographyOptions.find((option) => option.id === selectedOption) ?? typographyOptions[0];

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.previewLabel}>UI preview only</span>
          <h1>Typography direction</h1>
          <p>Compare the same Tetamu POS interface with three typography systems.</p>
        </div>
        <div className={styles.safetyNote}>
          <strong>Isolated preview</strong>
          <span>Production styles are unchanged</span>
        </div>
      </header>

      <section aria-label="Typography options" className={styles.optionGrid}>
        {typographyOptions.map((option, index) => (
          <button
            aria-pressed={selectedOption === option.id}
            className={`${styles.optionButton} ${styles[`${option.id}Sample`]}`}
            key={option.id}
            onClick={() => setSelectedOption(option.id)}
            type="button"
          >
            <span className={styles.optionNumber}>0{index + 1}</span>
            <span className={styles.optionCopy}>
              <span className={styles.optionTitleRow}>
                <strong>{option.name}</strong>
                {option.recommended ? <small>Recommended</small> : null}
              </span>
              <span>{option.description}</span>
              <b>RM1,280.00&nbsp;&nbsp; Customer 陈美玲</b>
            </span>
            <span className={styles.selectionMark} aria-hidden="true" />
          </button>
        ))}
      </section>

      <section className={`${styles.previewStage} ${styles[selectedOption]}`}>
        <header className={styles.stageHeader}>
          <div>
            <span>{selected.label}</span>
            <h2>{selected.name}</h2>
          </div>
          <div className={styles.typeScale}>
            <span>Aa</span>
            <p>Regular 400&nbsp;&nbsp; Medium 500&nbsp;&nbsp; Semibold 600&nbsp;&nbsp; Bold 700</p>
          </div>
        </header>

        <div className={styles.previewLayout}>
          <section className={styles.dashboardPreview} aria-label="Dashboard and table preview">
            <header className={styles.demoToolbar}>
              <div>
                <span>TETAMU POS</span>
                <h3>Daily overview</h3>
              </div>
              <div className={styles.toolbarActions}>
                <button className={styles.secondaryButton} type="button">Today</button>
                <button className={styles.primaryButton} type="button">New sale</button>
              </div>
            </header>

            <div className={styles.metrics}>
              <Metric label="Today sales" value="RM1,280.00" note="12 payments" />
              <Metric label="Active jobs" value="8" note="3 ready" />
              <Metric label="New customers" value="5" note="This week" />
              <Metric label="Outstanding" value="RM75.00" note="2 invoices" warning />
            </div>

            <section className={styles.tableSection}>
              <header>
                <div>
                  <span>Operations</span>
                  <h4>Recent jobs</h4>
                </div>
                <button className={styles.textButton} type="button">View all</button>
              </header>
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Vehicle</th>
                      <th>Status</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.vehicle}>
                        <td>{job.customer}<small>011 1221 2259</small></td>
                        <td>{job.vehicle}<small>Perodua Myvi</small></td>
                        <td><span className={styles.status}>{job.status}</span></td>
                        <td>{job.amount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className={styles.modalPreview} aria-label="Form and modal preview">
            <header className={styles.modalHeader}>
              <button aria-label="Close" className={styles.closeButton} type="button">x</button>
              <h3>New Job</h3>
              <span />
            </header>

            <div className={styles.modalBody}>
              <button className={styles.customerSelector} type="button">
                <span className={styles.avatar}>OY</span>
                <span><small>Customer</small><strong>OSCAR YONG</strong><b>01112212259</b></span>
                <span className={styles.chevron} aria-hidden="true">›</span>
              </button>

              <section className={styles.formSection}>
                <h4>Pick up contact</h4>
                <div className={styles.segmentedControl}>
                  <button className={styles.activeSegment} type="button"><strong>Registered owner</strong><span>Use customer phone</span></button>
                  <button type="button"><strong>Other person</strong><span>Pickup contact</span></button>
                </div>
              </section>

              <button className={styles.serviceSelector} type="button">
                <span>+</span>
                <strong>Select service</strong>
                <small>Optional</small>
              </button>

              <label className={styles.fieldLabel}>
                Notes <span>optional</span>
                <textarea placeholder="Add a short note" rows={3} />
              </label>

              <div className={styles.formSummary}>
                <span>Subtotal<strong>RM25.00</strong></span>
                <span>Total<strong>RM25.00</strong></span>
              </div>
            </div>

            <footer className={styles.modalFooter}>
              <button className={styles.secondaryButton} type="button">Cancel</button>
              <button className={styles.primaryButton} type="button">Confirm</button>
            </footer>
          </section>
        </div>
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  note,
  warning = false,
}: {
  label: string;
  value: string;
  note: string;
  warning?: boolean;
}) {
  return (
    <article className={warning ? styles.warningMetric : ""}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
