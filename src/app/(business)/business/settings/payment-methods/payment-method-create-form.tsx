import { createBusinessPaymentMethodAction } from "@/app/(business)/business/settings/payment-method-actions";
import styles from "./payment-methods.module.css";

const localCategories = [
  ["CASH", "Cash"],
  ["CARD", "Card"],
  ["DUITNOW", "DuitNow"],
  ["EWALLET", "E-Wallet"],
  ["BANK_TRANSFER", "Bank Transfer"],
] as const;

export function PaymentMethodCreateForm({
  nextSortOrder,
  returnTo,
}: {
  nextSortOrder: number;
  returnTo?: "business-settings";
}) {
  return (
    <section className={styles.addCard}>
      <input
        aria-label="Toggle add payment method form"
        className={styles.addToggle}
        id="payment-method-add-toggle"
        type="checkbox"
      />
      <label className={styles.addSummary} htmlFor="payment-method-add-toggle">
        <span className={styles.addSummaryIcon} aria-hidden="true">+</span>
        <span className={styles.addSummaryText}>
          <span className={styles.eyebrow}>Add new</span>
          <strong>Add payment method</strong>
          <small>Create a checkout button with the correct reporting rule.</small>
        </span>
        <span className={styles.openHint}>
          <span className={styles.openLabel}>Open</span>
          <span className={styles.closeLabel}>Close</span>
        </span>
      </label>

      <div className={styles.addFormWrap}>
        <form action={createBusinessPaymentMethodAction} className={styles.addForm}>
          {returnTo ? <input name="returnTo" type="hidden" value={returnTo} /> : null}
          <section className={styles.formSection}>
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>1</span>
              <span>
                <strong>Choose the payment type</strong>
                <small>This controls the information collected at checkout.</small>
              </span>
            </div>

            <fieldset className={styles.typePicker}>
              <legend className={styles.visuallyHidden}>Payment type</legend>
              <label className={styles.typeChoice}>
                <input defaultChecked name="paymentKind" type="radio" value="LOCAL_TENDER" />
                <span><strong>Malaysia payment</strong><small>MYR cash, card, QR, e-wallet or bank transfer.</small></span>
              </label>
              <label className={styles.typeChoice}>
                <input name="paymentKind" type="radio" value="FOREIGN_CURRENCY" />
                <span><strong>Foreign currency</strong><small>USD, SGD or another currency converted to MYR.</small></span>
              </label>
              <label className={styles.typeChoice}>
                <input name="paymentKind" type="radio" value="CRYPTO_ASSET" />
                <span><strong>Crypto asset</strong><small>BTC, ETH or USDT with quantity and MYR rate.</small></span>
              </label>
            </fieldset>
          </section>

          <section className={styles.formSection}>
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>2</span>
              <span>
                <strong>Name and reporting</strong>
                <small>Use a short name your cashier will recognise instantly.</small>
              </span>
            </div>

            <div className={styles.addDetails}>
              <label>
                <span>Checkout button name</span>
                <input name="label" placeholder="e.g. Touch & Go" required maxLength={40} />
                <small>This is the label shown to cashiers during payment.</small>
              </label>

              <div className={styles.localFields}>
                <label>
                  <span>Reporting category</span>
                  <select name="canonicalMethod" defaultValue="EWALLET">
                    {localCategories.map(([method, label]) => (
                      <option key={method} value={method}>{label}</option>
                    ))}
                  </select>
                  <small>Groups this button correctly in payment reports.</small>
                </label>
              </div>

              <div className={styles.foreignFields}>
                <label>
                  <span>Currency code</span>
                  <input autoCapitalize="characters" defaultValue="USD" maxLength={3} minLength={3} name="settlementCurrency" pattern="[A-Za-z]{3}" />
                  <small>Use a three-letter code such as USD or SGD.</small>
                </label>
                <div className={styles.myrNotice}>
                  <strong>Reports remain in MYR</strong>
                  <span>The cashier records the received amount and MYR rate at payment time. Foreign cash does not change the MYR cash drawer.</span>
                </div>
              </div>

              <div className={styles.cryptoFields}>
                <label>
                  <span>Asset symbol</span>
                  <input autoCapitalize="characters" defaultValue="BTC" maxLength={12} minLength={2} name="assetSymbol" pattern="[A-Za-z0-9]{2,12}" />
                  <small>Use the asset symbol, such as BTC, ETH or USDT.</small>
                </label>
                <div className={styles.myrNotice}>
                  <strong>Reports remain in MYR</strong>
                  <span>The cashier records the asset quantity, MYR rate and transaction reference at payment time.</span>
                </div>
              </div>
            </div>
          </section>

          <input name="sortOrder" type="hidden" value={nextSortOrder} />
          <div className={styles.addFormFooter}>
            <span>
              <strong>Ready for checkout</strong>
              <small>The new button will be enabled immediately. You can hide or rename it later.</small>
            </span>
            <button className={styles.addButton} type="submit">Add payment method</button>
          </div>
        </form>
      </div>
    </section>
  );
}
