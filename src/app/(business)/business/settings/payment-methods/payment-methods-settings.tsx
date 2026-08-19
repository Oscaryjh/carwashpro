import { updateBusinessPaymentMethodAction } from "@/app/(business)/business/settings/payment-method-actions";
import {
  configurablePaymentMethods,
  paymentMethodCategoryLabel,
  paymentMethodSettlementLabel,
  type EffectiveBusinessPaymentMethod,
} from "@/lib/payments/business-methods";
import { PaymentMethodCreateForm } from "./payment-method-create-form";
import { PaymentMethodRemoveButton } from "./payment-method-remove-button";
import { PaymentMethodVisibilityButton } from "./payment-method-visibility-button";
import styles from "./payment-methods.module.css";

type PaymentMethodsSettingsProps = {
  methods: EffectiveBusinessPaymentMethod[];
  returnTo?: "business-settings";
};

export function PaymentMethodsSettings({
  methods,
  returnTo,
}: PaymentMethodsSettingsProps) {
  const nextSortOrder = Math.max(100, ...methods.map((method) => method.sortOrder + 10));
  const enabledCount = methods.filter((method) => method.active).length;
  const hiddenCount = methods.length - enabledCount;

  return (
    <>
      <section className={styles.guide}>
        <strong>Keep checkout simple</strong>
        <p>
          Cashiers only see enabled buttons. Open a payment method below when you need to
          rename it, change its reporting group or remove it from checkout.
        </p>
      </section>

      <PaymentMethodCreateForm nextSortOrder={nextSortOrder} returnTo={returnTo} />

      <section className={styles.listSection}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Checkout buttons</span>
            <h2>Payment methods</h2>
            <p>Click a method to view or edit its settings.</p>
          </div>
          <div className={styles.methodCounts} aria-label={`${enabledCount} enabled and ${hiddenCount} hidden`}>
            <span className={styles.enabledCount}>{enabledCount} enabled</span>
            {hiddenCount > 0 ? <span className={styles.hiddenCount}>{hiddenCount} hidden</span> : null}
          </div>
        </div>
        <div className={styles.methodList}>
          {methods.map((method) => {
            const reportingLabel = method.behavior === "TRAINING_COMPLIMENTARY"
              ? "No payment collected"
              : paymentMethodSettlementLabel(method);

            return (
              <details className={styles.methodCard} key={method.code}>
                <summary className={styles.methodSummary}>
                  <span className={styles.methodSummaryMain}>
                    <span className={styles.methodIcon} aria-hidden="true">
                      {method.label.slice(0, 1).toUpperCase()}
                    </span>
                    <span className={styles.methodName}>
                      <strong>{method.label}</strong>
                      <small>{reportingLabel}</small>
                    </span>
                  </span>
                  <span className={method.active ? styles.activeBadge : styles.inactiveBadge}>
                    {method.active ? "Enabled" : "Hidden"}
                  </span>
                  <span className={styles.editHint}>Edit <span aria-hidden="true">⌄</span></span>
                </summary>

                <form action={updateBusinessPaymentMethodAction} className={styles.methodEditor}>
                  {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
                  <input name="id" type="hidden" value={method.id ?? ""} />
                  <input name="code" type="hidden" value={method.code} />
                  <input name="sortOrder" type="hidden" value={method.sortOrder} />

                  <div className={styles.methodIdentity}>
                    <strong>{method.builtIn ? "System payment method" : "Custom payment method"}</strong>
                    <small>
                      {method.builtIn
                        ? method.behavior === "TRAINING_COMPLIMENTARY"
                          ? "Completes a zero-value sale while preserving original-price commission."
                          : "Hide it from checkout when unused; historical reporting remains intact."
                        : "You can remove it while it has no payment history."}
                    </small>
                  </div>
                  <label>
                    <span>Checkout button name</span>
                    <input name="label" defaultValue={method.label} required maxLength={40} />
                  </label>
                  {method.builtIn || method.paymentKind !== "LOCAL_TENDER" ? (
                    <label>
                      <span>Reporting category</span>
                      <span className={styles.lockedCategory}>
                        {method.behavior === "TRAINING_COMPLIMENTARY"
                          ? "No payment collected"
                          : method.paymentKind !== "LOCAL_TENDER"
                            ? paymentMethodSettlementLabel(method)
                            : "Fixed system category"}
                      </span>
                      <input name="canonicalMethod" type="hidden" value={method.canonicalMethod} />
                    </label>
                  ) : (
                    <label>
                      <span>Reporting category</span>
                      <select name="canonicalMethod" defaultValue={method.canonicalMethod}>
                        {configurablePaymentMethods
                          .filter((category) => category !== "FOREIGN_CURRENCY" && category !== "CRYPTO")
                          .map((category) => (
                            <option key={category} value={category}>
                              {paymentMethodCategoryLabel(category)}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  <label className={styles.statusField}>
                    <span>Checkout visibility</span>
                    <select name="active" defaultValue={method.active ? "true" : "false"}>
                      <option value="true">Show at checkout</option>
                      <option value="false">Hide from checkout</option>
                    </select>
                  </label>
                  <div className={styles.methodActions}>
                    <button className={styles.saveButton} type="submit">Save changes</button>
                    {method.builtIn ? (
                      <PaymentMethodVisibilityButton
                        active={method.active}
                        className={styles.visibilityButton}
                        methodLabel={method.label}
                      />
                    ) : method.id ? (
                      <PaymentMethodRemoveButton
                        className={styles.removeButton}
                        methodLabel={method.label}
                      />
                    ) : null}
                  </div>
                </form>
              </details>
            );
          })}
        </div>
      </section>
    </>
  );
}
