"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import type { CashierSaleInvoiceSummary, CashierSaleState } from "@/app/cashier/actions";
import { AppointmentInvoiceModal } from "@/components/appointment-invoice-modal";
import {
  PackageCustomerPicker,
  type PackageCustomerOption,
} from "@/components/package-customer-picker";
import styles from "@/components/cashier-pos-preview.module.css";
import type {
  CashierCatalogItem,
  CashierCatalogResult,
  CashierCatalogType,
} from "@/lib/cashier/catalog";
import { calculateLoyaltyRedemption } from "@/lib/loyalty/rules";
import { calculateTax, type TaxDisplaySettings } from "@/lib/tax/calculator";

type CartLine = CashierCatalogItem & { quantity: number };

type CashierUnifiedSaleFormProps = {
  action: (formData: FormData) => Promise<CashierSaleState>;
  branchId: string;
  initialCatalog: CashierCatalogResult;
  taxSettings: TaxDisplaySettings;
  loyaltySettings: {
    enabled: boolean;
    redemptionEnabled: boolean;
    pointsPerRinggit: number;
    minimumPoints: number;
  };
};

const paymentMethods = [
  { label: "Cash", value: "CASH" },
  { label: "Card", value: "CARD" },
  { label: "DuitNow", value: "DUITNOW" },
  { label: "E-Wallet", value: "EWALLET" },
  { label: "Bank", value: "BANK_TRANSFER" },
] as const;

export function CashierUnifiedSaleForm({
  action,
  branchId,
  initialCatalog,
  taxSettings,
  loyaltySettings,
}: CashierUnifiedSaleFormProps) {
  const router = useRouter();
  const [catalogType, setCatalogType] = useState<CashierCatalogType>("product");
  const [category, setCategory] = useState("All categories");
  const [customer, setCustomer] = useState<PackageCustomerOption | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [cashReceived, setCashReceived] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogData, setCatalogData] = useState(initialCatalog);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [adjustmentsOpen, setAdjustmentsOpen] = useState(false);
  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [discountValue, setDiscountValue] = useState("0");
  const [discountReason, setDiscountReason] = useState("");
  const [loyaltyPoints, setLoyaltyPoints] = useState("0");
  const [saleError, setSaleError] = useState("");
  const [completedInvoice, setCompletedInvoice] = useState<CashierSaleInvoiceSummary | null>(null);
  const [customerPickerKey, setCustomerPickerKey] = useState(0);
  const skipInitialRequest = useRef(true);
  const cashReceivedRef = useRef<HTMLInputElement>(null);
  const categories = ["All categories", ...catalogData.categories];
  const currentCatalogPage = catalogData.page;
  const catalogPageCount = catalogData.pageCount;
  const visibleItems = catalogData.items;

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setCatalogData(initialCatalog);
  }, [initialCatalog]);

  useEffect(() => {
    if (skipInitialRequest.current) {
      skipInitialRequest.current = false;
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      branchId,
      page: catalogPage.toString(),
      type: catalogType,
    });
    if (category !== "All categories") params.set("category", category);
    if (debouncedQuery) params.set("q", debouncedQuery);

    setCatalogLoading(true);
    setCatalogError("");
    fetch(`/api/cashier/catalog?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CashierCatalogResult & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Unable to load sale items.");
        setCatalogData(payload);
        if (payload.page !== catalogPage) setCatalogPage(payload.page);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCatalogError(error instanceof Error ? error.message : "Unable to load sale items.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });

    return () => controller.abort();
  }, [branchId, catalogPage, catalogType, category, debouncedQuery]);

  const hasPackages = lines.some((line) => line.type === "package");
  const totalItems = lines.reduce((sum, line) => sum + line.quantity, 0);
  const hasStockError = lines.some((line) => line.type === "product" && line.quantity > (line.stock ?? 0));
  const subtotal = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
  const numericDiscountValue = Math.max(0, Number(discountValue) || 0);
  const manualDiscount = Math.min(
    subtotal,
    discountType === "PERCENT"
      ? subtotal * Math.min(100, numericDiscountValue) / 100
      : numericDiscountValue,
  );
  const manualDiscountError = manualDiscount > 0 && !discountReason.trim()
    ? "Enter a reason for the discount."
    : "";
  const redemption = useMemo(() => {
    const requestedPoints = Math.max(0, Math.floor(Number(loyaltyPoints) || 0));
    if (!requestedPoints) return { discountCents: 0, error: "", points: 0 };
    if (!customer) {
      return { discountCents: 0, error: "Select a customer to use points.", points: 0 };
    }
    if (!loyaltySettings.enabled || !loyaltySettings.redemptionEnabled) {
      return { discountCents: 0, error: "Point redemption is not enabled.", points: 0 };
    }

    try {
      const result = calculateLoyaltyRedemption({
        availablePoints: customer.loyaltyPoints ?? 0,
        maximumDiscountCents: Math.max(0, Math.round((subtotal - manualDiscount) * 100)),
        minimumPoints: loyaltySettings.minimumPoints,
        pointsPerRinggit: loyaltySettings.pointsPerRinggit,
        requestedPoints,
      });
      return { ...result, error: "" };
    } catch (error) {
      return {
        discountCents: 0,
        error: error instanceof Error ? error.message : "Points cannot be applied.",
        points: 0,
      };
    }
  }, [customer, loyaltyPoints, loyaltySettings, manualDiscount, subtotal]);
  const loyaltyDiscount = redemption.discountCents / 100;
  const totalDiscount = manualDiscount + loyaltyDiscount;

  const tax = useMemo(() => calculateTax({
    lines: lines.map((line) => {
      return {
        lineTotal: line.price * line.quantity,
        taxable: line.taxable,
        taxRate: line.taxRate,
      };
    }),
    sstEnabled: taxSettings.enabled,
    sstLabel: taxSettings.label,
    sstRate: taxSettings.rate,
    discount: totalDiscount,
  }), [lines, taxSettings, totalDiscount]);

  const totalCents = Math.max(0, Math.round(tax.total * 100));
  const cashReceivedCents = Math.max(0, Math.round((Number(cashReceived) || 0) * 100));
  const cashPaymentReady = paymentMethod !== "CASH" || totalCents === 0 || cashReceivedCents >= totalCents;
  const cashChange = Math.max(0, cashReceivedCents - totalCents) / 100;

  const canPay = Boolean(
    lines.length &&
      (!hasPackages || customer) &&
      !hasStockError &&
      !manualDiscountError &&
      !redemption.error,
  );

  function useMaximumPoints() {
    if (!customer || !loyaltySettings.redemptionEnabled) return;
    const affordableRinggit = Math.floor(Math.max(0, subtotal - manualDiscount));
    const maximumBySale = affordableRinggit * loyaltySettings.pointsPerRinggit;
    const maximum = Math.min(customer.loyaltyPoints ?? 0, maximumBySale);
    const wholePoints = Math.floor(maximum / loyaltySettings.pointsPerRinggit) * loyaltySettings.pointsPerRinggit;
    setLoyaltyPoints(String(wholePoints));
  }

  function switchCatalog(nextType: CashierCatalogType) {
    setCatalogType(nextType);
    setCategory("All categories");
    setCatalogPage(1);
  }

  function selectCategory(nextCategory: string) {
    setCategory(nextCategory);
    setCatalogPage(1);
  }

  function addItem(item: CashierCatalogItem) {
    if (item.type === "product" && (item.stock ?? 0) < 1) return;
    setLines((current) => {
      const existing = current.find((line) => line.type === item.type && line.id === item.id);
      if (!existing) return [...current, { ...item, quantity: 1 }];
      const maximum = item.type === "product" ? item.stock ?? 0 : 99;
      return current.map((line) =>
        line.type === item.type && line.id === item.id
          ? { ...line, quantity: Math.min(maximum || 1, line.quantity + 1) }
          : line,
      );
    });
  }

  function updateQuantity(index: number, requested: number) {
    setLines((current) => {
      const selected = current[index];
      if (!selected) return current;
      if (requested < 1) return current.filter((_, lineIndex) => lineIndex !== index);
      const maximum = selected.type === "product" ? selected.stock ?? 0 : 99;
      return current.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, quantity: Math.max(1, Math.min(maximum || 1, requested)) }
          : line,
      );
    });
  }

  async function submitSale(formData: FormData) {
    setSaleError("");
    if (!cashPaymentReady) {
      setSaleError(`Enter at least ${formatMoney(tax.total)} cash received.`);
      cashReceivedRef.current?.focus();
      return;
    }

    const result = await action(formData);

    if (result.status !== "success" || !result.invoice) {
      setSaleError(result.message || "Unable to complete cashier sale.");
      return;
    }

    setCompletedInvoice(result.invoice);
    setLines([]);
    setCustomer(null);
    setCustomerPickerKey((key) => key + 1);
    setDiscountType("AMOUNT");
    setDiscountValue("0");
    setDiscountReason("");
    setLoyaltyPoints("0");
    setAdjustmentsOpen(false);
    setCashReceived("");
    router.refresh();
  }

  return (
    <>
    <form action={submitSale} className={`${styles.posShell} ${styles.formalShell}`}>
      <section aria-label="Sale catalog" className={styles.catalogPanel}>
        <header className={styles.panelHeader}>
          <div>
            <span>SALE CATALOG</span>
            <h2>Products, services and packages</h2>
          </div>
          <label className={styles.searchField}>
            <input
              aria-label="Search catalog"
              onChange={(event) => {
                setQuery(event.target.value);
                setCatalogPage(1);
              }}
              placeholder="Search product, service, package, SKU, or category"
              value={query}
            />
          </label>
        </header>

        <div className={styles.catalogTabs} role="tablist">
          {(["product", "service", "package"] as CashierCatalogType[]).map((option) => (
            <button
              aria-selected={catalogType === option}
              className={catalogType === option ? styles.activeTab : ""}
              key={option}
              onClick={() => switchCatalog(option)}
              role="tab"
              type="button"
            >
              {option === "product"
                ? "Products"
                : option === "service"
                  ? "Services"
                  : "Packages"}
            </button>
          ))}
        </div>

        <div aria-label="Catalog categories" className={styles.categoryBar}>
          {categories.map((option) => (
            <button
              className={category === option ? styles.activeCategory : ""}
              key={option}
              onClick={() => selectCategory(option)}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>

        <div aria-busy={catalogLoading} className={styles.catalogGrid}>
          {visibleItems.map((item) => {
            const selected = lines.find((line) => line.type === item.type && line.id === item.id);
            const outOfStock = item.type === "product" && (item.stock ?? 0) < 1;
            return (
              <button
                className={`${styles.itemTile} ${selected ? styles.itemTileAdded : ""}`}
                disabled={catalogLoading || outOfStock}
                key={`${item.type}-${item.id}`}
                onClick={() => addItem(item)}
                type="button"
              >
                <span className={styles.itemCopy}>
                  <strong>{item.name}</strong>
                  <small>
                    {item.category ??
                      (item.type === "package"
                        ? "Package"
                        : item.type === "service"
                          ? "Service"
                          : "Product")} · {item.description}
                  </small>
                </span>
                <span className={styles.itemPrice}>{formatMoney(item.price)}</span>
                <span className={`${styles.quickAdd} ${selected ? styles.quickAddSelected : ""}`}>
                  {outOfStock ? (
                    "–"
                  ) : selected ? (
                    <>
                      <span>Qty</span>
                      <strong>{selected.quantity}</strong>
                    </>
                  ) : (
                    "+"
                  )}
                </span>
              </button>
            );
          })}
          {catalogLoading ? <p className={styles.emptyCatalog}>Loading sale items...</p> : null}
          {!catalogLoading && catalogError ? <p className={styles.emptyCatalog}>{catalogError}</p> : null}
          {!catalogLoading && !catalogError && !visibleItems.length ? (
            <p className={styles.emptyCatalog}>No matching sale items.</p>
          ) : null}
        </div>

        {catalogData.total ? (
          <nav aria-label="Catalog pages" className={styles.catalogPagination}>
            <span>
              {(currentCatalogPage - 1) * catalogData.pageSize + 1}–{Math.min(currentCatalogPage * catalogData.pageSize, catalogData.total)} of {catalogData.total}
            </span>
            <div>
              <button
                aria-label="Previous catalog page"
                disabled={currentCatalogPage === 1}
                onClick={() => setCatalogPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                ‹
              </button>
              <strong>{currentCatalogPage} / {catalogPageCount}</strong>
              <button
                aria-label="Next catalog page"
                disabled={currentCatalogPage === catalogPageCount}
                onClick={() => setCatalogPage((page) => Math.min(catalogPageCount, page + 1))}
                type="button"
              >
                ›
              </button>
            </div>
          </nav>
        ) : null}
      </section>

      <aside aria-label="Current sale" className={styles.orderPanel}>
        <header className={styles.orderHeader}>
          <div>
            <span>CURRENT SALE</span>
            <h2>{totalItems ? `${totalItems} ${totalItems === 1 ? "item" : "items"}` : "New sale"}</h2>
          </div>
          {lines.length ? <button onClick={() => setLines([])} type="button">Clear</button> : null}
        </header>

        <div className={styles.customerArea}>
          <PackageCustomerPicker
            buttonClassName={`${styles.customerButton} ${hasPackages && !customer ? styles.customerRequired : ""}`}
            compactAccountNote
            includeVehicleDetails={false}
            key={customerPickerKey}
            onSelectionChange={(nextCustomer) => {
              setCustomer(nextCustomer);
              if (!nextCustomer) setLoyaltyPoints("0");
            }}
            posDisplay
            required={hasPackages}
          />
        </div>

        <div className={styles.orderLines}>
          {lines.map((line, index) => {
            const name = line.name;
            const lineTotal = line.price * line.quantity;
            const maximumQuantity = line.type === "product" ? line.stock ?? 0 : 99;
            const removesLine = line.quantity === 1;
            const reachedMaximum = line.quantity >= Math.max(1, maximumQuantity);
            return (
              <div className={styles.orderLine} key={`${line.type}-${line.id}`}>
                <div className={styles.lineMain}>
                  <strong title={name}>{name}</strong>
                  <small>
                    {line.type === "package"
                      ? "Package"
                      : line.type === "service"
                        ? `Service · ${formatMoney(line.price)}`
                        : formatMoney(line.price)}
                  </small>
                </div>
                <div aria-label={`Quantity for ${name}`} className={styles.stepper} role="group">
                  <button
                    aria-label={removesLine ? `Remove ${name}` : `Reduce ${name}`}
                    className={removesLine ? styles.stepperRemove : undefined}
                    onClick={() => updateQuantity(index, line.quantity - 1)}
                    title={removesLine ? "Remove item" : "Decrease quantity"}
                    type="button"
                  >
                    &minus;
                  </button>
                  <output aria-live="polite">{line.quantity}</output>
                  <button
                    aria-label={`Add ${name}`}
                    disabled={reachedMaximum}
                    onClick={() => updateQuantity(index, line.quantity + 1)}
                    title={reachedMaximum ? "Maximum quantity reached" : "Increase quantity"}
                    type="button"
                  >
                    +
                  </button>
                </div>
                <strong className={styles.lineTotal}>{formatMoney(lineTotal)}</strong>
                <input
                  name={
                    line.type === "package"
                      ? "packageId"
                      : line.type === "service"
                        ? "serviceId"
                        : "productId"
                  }
                  type="hidden"
                  value={line.id}
                />
                <input
                  name={
                    line.type === "package"
                      ? "packageQuantity"
                      : line.type === "service"
                        ? "serviceQuantity"
                        : "productQuantity"
                  }
                  type="hidden"
                  value={line.quantity}
                />
              </div>
            );
          })}
          {!lines.length ? (
            <div className={styles.emptyOrder}>
              <span>+</span>
              <strong>No items yet</strong>
              <small>Select an item from the catalog.</small>
            </div>
          ) : null}
        </div>

        <section className={styles.adjustmentsPanel}>
          <button
            aria-expanded={adjustmentsOpen}
            className={styles.adjustmentsToggle}
            onClick={() => setAdjustmentsOpen((open) => !open)}
            type="button"
          >
            <span>
              <strong>Discount &amp; rewards</strong>
              <small>
                {totalDiscount > 0
                  ? `${formatMoney(totalDiscount)} applied`
                  : "Manual discount or TETAMU Points"}
              </small>
            </span>
            <b>{adjustmentsOpen ? "−" : "+"}</b>
          </button>
          {adjustmentsOpen ? (
            <div className={styles.adjustmentsBody}>
              <div className={styles.discountControls}>
                <div className={styles.discountMode}>
                  <button
                    className={discountType === "AMOUNT" ? styles.activeAdjustment : ""}
                    onClick={() => setDiscountType("AMOUNT")}
                    type="button"
                  >
                    RM
                  </button>
                  <button
                    className={discountType === "PERCENT" ? styles.activeAdjustment : ""}
                    onClick={() => setDiscountType("PERCENT")}
                    type="button"
                  >
                    %
                  </button>
                </div>
                <input
                  aria-label="Discount value"
                  min="0"
                  onChange={(event) => setDiscountValue(event.target.value)}
                  placeholder="0"
                  step={discountType === "PERCENT" ? "1" : "0.01"}
                  type="number"
                  value={discountValue}
                />
              </div>
              <input
                aria-label="Discount reason"
                className={styles.reasonInput}
                maxLength={160}
                onChange={(event) => setDiscountReason(event.target.value)}
                placeholder="Discount reason"
                value={discountReason}
              />
              <div className={styles.rewardRow}>
                <span>
                  <strong>TETAMU Points</strong>
                  <small>
                    {customer
                      ? `${customer.loyaltyPoints ?? 0} pts available · ${loyaltySettings.pointsPerRinggit} pts = RM1`
                      : "Select a customer to use points"}
                  </small>
                </span>
                <input
                  aria-label="Loyalty points to redeem"
                  disabled={!customer || !loyaltySettings.redemptionEnabled}
                  min="0"
                  onChange={(event) => setLoyaltyPoints(event.target.value)}
                  step={loyaltySettings.pointsPerRinggit}
                  type="number"
                  value={loyaltyPoints}
                />
                <button
                  disabled={!customer || !loyaltySettings.redemptionEnabled}
                  onClick={useMaximumPoints}
                  type="button"
                >
                  Max
                </button>
              </div>
              <div className={styles.savtRow}>
                <span><strong>SAVT rewards</strong><small>Partner connection not available</small></span>
                <b>Not connected</b>
              </div>
              {manualDiscountError || redemption.error ? (
                <p className={styles.adjustmentError}>{manualDiscountError || redemption.error}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <div className={styles.orderSummary}>
          <div><span>Subtotal</span><strong>{formatMoney(tax.subtotal)}</strong></div>
          {manualDiscount > 0 ? (
            <div><span>Discount</span><strong>−{formatMoney(manualDiscount)}</strong></div>
          ) : null}
          {loyaltyDiscount > 0 ? (
            <div>
              <span>TETAMU Points ({redemption.points} pts)</span>
              <strong>−{formatMoney(loyaltyDiscount)}</strong>
            </div>
          ) : null}
          {taxSettings.enabled ? (
            <div><span>{formatTaxLabel(tax.taxLabel, tax.taxRate)}</span><strong>{formatMoney(tax.tax)}</strong></div>
          ) : null}
          <div className={styles.totalRow}><span>Total</span><strong>{formatMoney(tax.total)}</strong></div>
        </div>

        <div aria-label="Payment method" className={`${styles.paymentMethods} ${styles.paymentMethodsAll}`}>
          {paymentMethods.map((method) => (
            <button
              className={paymentMethod === method.value ? styles.activePayment : ""}
              key={method.value}
              onClick={() => {
                setPaymentMethod(method.value);
                if (method.value === "CASH") {
                  window.requestAnimationFrame(() => cashReceivedRef.current?.focus());
                }
              }}
              type="button"
            >
              {method.label}
            </button>
          ))}
        </div>
        <input name="method" type="hidden" value={paymentMethod} />
        <input name="discountType" type="hidden" value={discountType} />
        <input name="discountValue" type="hidden" value={numericDiscountValue} />
        <input name="discountReason" type="hidden" value={discountReason} />
        <input name="loyaltyPoints" type="hidden" value={redemption.points} />
        {paymentMethod === "CASH" ? (
          <div className={styles.cashTender}>
            <label>
              <span>Cash received</span>
              <input
                aria-invalid={!cashPaymentReady}
                inputMode="decimal"
                min="0"
                onChange={(event) => setCashReceived(event.target.value)}
                placeholder={formatMoney(tax.total)}
                ref={cashReceivedRef}
                step="0.01"
                type="number"
                value={cashReceived}
              />
            </label>
            <div className={styles.cashChange}>
              <span>Change</span>
              <strong>{formatMoney(cashChange)}</strong>
            </div>
          </div>
        ) : (
          <label className={styles.referenceField}>
            <span>Payment reference</span>
            <input maxLength={120} name="reference" placeholder="Enter transaction reference" required />
          </label>
        )}

        {hasStockError ? <p className={styles.submitMessage}>A product quantity exceeds available stock.</p> : null}
        {saleError ? <p className={styles.submitMessage}>{saleError}</p> : null}
        <CashierPayButton
          canPay={canPay && cashPaymentReady}
          cashRequired={paymentMethod === "CASH" && !cashPaymentReady}
          customerRequired={hasPackages && !customer}
          total={tax.total}
        />
        <input name="branchId" type="hidden" value={branchId} />
      </aside>
    </form>
    {completedInvoice ? (
      <AppointmentInvoiceModal
        invoice={completedInvoice}
        onClose={() => setCompletedInvoice(null)}
      />
    ) : null}
    </>
  );
}

function CashierPayButton({
  canPay,
  cashRequired,
  customerRequired,
  total,
}: {
  canPay: boolean;
  cashRequired: boolean;
  customerRequired: boolean;
  total: number;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={styles.payButton} disabled={!canPay || pending} type="submit">
      {pending
        ? "Processing..."
        : customerRequired
          ? "Select customer to continue"
          : cashRequired
            ? "Enter cash received"
            : `Pay ${formatMoney(total)}`}
    </button>
  );
}

function formatMoney(value: number) {
  return `RM${value.toFixed(2)}`;
}

function formatTaxLabel(label: string, rate: number) {
  if (rate <= 0) return label;
  const formattedRate = Number.isInteger(rate)
    ? rate.toFixed(0)
    : rate.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${label} (${formattedRate}%)`;
}
