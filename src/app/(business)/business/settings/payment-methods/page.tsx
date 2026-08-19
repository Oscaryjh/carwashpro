import Link from "next/link";
import { assertRole } from "@/lib/auth/permissions";
import { getEffectiveBusinessPaymentMethods } from "@/lib/payments/business-methods";
import { requireBusinessContext } from "@/lib/tenant";
import styles from "./payment-methods.module.css";
import { PaymentMethodsSettings } from "./payment-methods-settings";

type PaymentMethodsPageProps = {
  searchParams: Promise<{ message?: string; type?: string }>;
};

export default async function PaymentMethodsPage({ searchParams }: PaymentMethodsPageProps) {
  const context = await requireBusinessContext({ capability: "MODIFY_BUSINESS_SETTINGS" });
  assertRole(context.user, ["BUSINESS_OWNER"]);
  const params = await searchParams;
  const methods = await getEffectiveBusinessPaymentMethods(context.businessId);

  return (
    <section className={`content ${styles.page}`}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>Company settings</span>
          <h1>Payment methods</h1>
          <p>Choose the payment buttons your team sees at checkout.</p>
        </div>
        <Link className="secondary-link-button" href="/business/settings">Back to settings</Link>
      </header>

      {params.message ? (
        <div className={params.type === "error" ? "error" : "success"}>{params.message}</div>
      ) : null}

      <PaymentMethodsSettings methods={methods} />
    </section>
  );
}
