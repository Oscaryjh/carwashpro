"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal, useFormStatus } from "react-dom";
import type { CashierSaleInvoiceSummary, CashierSaleState } from "@/app/(business)/cashier/actions";
import { AppointmentInvoiceModal } from "@/components/appointment-invoice-modal";
import { MoneyNumpadInput } from "@/components/money-numpad-input";
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
import {
  calculateCatalogDiscountCents,
  formatCatalogDiscountScope,
  formatCatalogDiscountValue,
  type CatalogDiscountOption,
} from "@/lib/catalog-discounts";
import { calculateLoyaltyRedemption } from "@/lib/loyalty/rules";
import { calculateTax, type TaxDisplaySettings } from "@/lib/tax/calculator";

type CartLine = CashierCatalogItem & { quantity: number };

type CashierUnifiedSaleFormProps = {
  action: (formData: FormData) => Promise<CashierSaleState>;
  branchId: string;
  catalogDiscounts: CatalogDiscountOption[];
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
  { label: "E-Wallet", value: "EWALLET" },
  { label: "Bank", value: "BANK_TRANSFER" },
] as const;

export function CashierUnifiedSaleForm({
  action,
  branchId,
  catalogDiscounts,
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
  const [adjustmentTab, setAdjustmentTab] = useState<"DISCOUNT" | "POINTS">("DISCOUNT");
  const [discountType, setDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [discountValue, setDiscountValue] = useState("0");
  const [discountReference, setDiscountReference] = useState("");
  const [catalogDiscountId, setCatalogDiscountId] = useState("");
  const [loyaltyPoints, setLoyaltyPoints] = useState("0");
  const [draftDiscountType, setDraftDiscountType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [draftDiscountValue, setDraftDiscountValue] = useState("0");
  const [draftDiscountReference, setDraftDiscountReference] = useState("");
  const [draftCatalogDiscountId, setDraftCatalogDiscountId] = useState("");
  const [draftLoyaltyPoints, setDraftLoyaltyPoints] = useState("0");
  const [saleError, setSaleError] = useState("");
  const [completedInvoice, setCompletedInvoice] = useState<CashierSaleInvoiceSummary | null>(null);
  const [customerPickerKey, setCustomerPickerKey] = useState(0);
  const skipInitialRequest = useRef(true);
  const cashReceivedRef = useRef<HTMLInputElement>(null);
  const customerPickerButtonRef = useRef<HTMLButtonElement>(null);
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
  const selectedCatalogDiscount = catalogDiscounts.find((discount) => discount.id === catalogDiscountId) ?? null;
  const catalogDiscountAmount = selectedCatalogDiscount
    ? calculateCatalogDiscountCents({
        discount: selectedCatalogDiscount,
        lines: lines.map((line) => ({
          lineTotalCents: Math.round(line.price * line.quantity * 100),
          type: line.type,
        })),
      }) / 100
    : 0;
  const numericDiscountValue = Math.max(0, Number(discountValue) || 0);
  const manualDiscount = selectedCatalogDiscount
    ? catalogDiscountAmount
    : Math.min(
        subtotal,
        discountType === "PERCENT"
          ? subtotal * Math.min(100, numericDiscountValue) / 100
          : numericDiscountValue,
      );
  const discountReferenceError = (selectedCatalogDiscount || manualDiscount > 0) && !discountReference.trim()
    ? "Enter a reference for the discount."
    : "";
  const redemption = useMemo(() => {
    const requestedPoints = Math.max(0, Math.floor(Number(loyaltyPoints) || 0));
    if (!requestedPoints) return { discountCents: 0, error: "", points: 0 };
    if (!customer) {
      return { discountCents: 0, error: "Select a customer to use points.", points: 0 };
    }
    if (selectedCatalogDiscount && !selectedCatalogDiscount.allowLoyaltyStacking) {
      return { discountCents: 0, error: "This discount cannot be combined with loyalty points.", points: 0 };
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
  }, [customer, loyaltyPoints, loyaltySettings, manualDiscount, selectedCatalogDiscount, subtotal]);
  const loyaltyDiscount = redemption.discountCents / 100;
  const totalDiscount = manualDiscount + loyaltyDiscount;

  const draftNumericDiscountValue = Math.max(0, Number(draftDiscountValue) || 0);
  const draftCatalogDiscount = catalogDiscounts.find((discount) => discount.id === draftCatalogDiscountId) ?? null;
  const draftCatalogDiscountAmount = draftCatalogDiscount
    ? calculateCatalogDiscountCents({
        discount: draftCatalogDiscount,
        lines: lines.map((line) => ({
          lineTotalCents: Math.round(line.price * line.quantity * 100),
          type: line.type,
        })),
      }) / 100
    : 0;
  const draftManualDiscount = draftCatalogDiscount
    ? draftCatalogDiscountAmount
    : Math.min(
        subtotal,
        draftDiscountType === "PERCENT"
          ? subtotal * Math.min(100, draftNumericDiscountValue) / 100
          : draftNumericDiscountValue,
      );
  const draftDiscountReferenceError = (draftCatalogDiscount || draftManualDiscount > 0) && !draftDiscountReference.trim()
    ? "Enter a reference for the discount."
    : "";
  const draftRedemption = useMemo(() => {
    const requestedPoints = Math.max(0, Math.floor(Number(draftLoyaltyPoints) || 0));
    if (!requestedPoints) return { discountCents: 0, error: "", points: 0 };
    if (!customer) {
      return { discountCents: 0, error: "Select a customer to use points.", points: 0 };
    }
    if (draftCatalogDiscount && !draftCatalogDiscount.allowLoyaltyStacking) {
      return { discountCents: 0, error: "This discount cannot be combined with loyalty points.", points: 0 };
    }
    if (!loyaltySettings.enabled || !loyaltySettings.redemptionEnabled) {
      return { discountCents: 0, error: "Point redemption is not enabled.", points: 0 };
    }

    try {
      const result = calculateLoyaltyRedemption({
        availablePoints: customer.loyaltyPoints ?? 0,
        maximumDiscountCents: Math.max(0, Math.round((subtotal - draftManualDiscount) * 100)),
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
  }, [
    customer,
    draftLoyaltyPoints,
    draftManualDiscount,
    draftCatalogDiscount,
    loyaltySettings,
    subtotal,
  ]);
  const draftLoyaltyDiscount = draftRedemption.discountCents / 100;
  const draftTotalDiscount = draftManualDiscount + draftLoyaltyDiscount;

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

  const draftTax = useMemo(() => calculateTax({
    lines: lines.map((line) => ({
      lineTotal: line.price * line.quantity,
      taxable: line.taxable,
      taxRate: line.taxRate,
    })),
    sstEnabled: taxSettings.enabled,
    sstLabel: taxSettings.label,
    sstRate: taxSettings.rate,
    discount: draftTotalDiscount,
  }), [draftTotalDiscount, lines, taxSettings]);

  const totalCents = Math.max(0, Math.round(tax.total * 100));
  const cashReceivedCents = Math.max(0, Math.round((Number(cashReceived) || 0) * 100));
  const cashPaymentReady = paymentMethod !== "CASH" || totalCents === 0 || cashReceivedCents >= totalCents;
  const cashChange = Math.max(0, cashReceivedCents - totalCents) / 100;

  const canPay = Boolean(
    lines.length &&
      (!hasPackages || customer) &&
      !hasStockError &&
      !discountReferenceError &&
      !redemption.error,
  );

  function useMaximumPoints() {
    if (!customer || !loyaltySettings.redemptionEnabled) return;
    const affordableRinggit = Math.floor(Math.max(0, subtotal - draftManualDiscount));
    const maximumBySale = affordableRinggit * loyaltySettings.pointsPerRinggit;
    const maximum = Math.min(customer.loyaltyPoints ?? 0, maximumBySale);
    const wholePoints = Math.floor(maximum / loyaltySettings.pointsPerRinggit) * loyaltySettings.pointsPerRinggit;
    setDraftLoyaltyPoints(String(wholePoints));
  }

  function openCustomerPickerFromRewards() {
    setAdjustmentsOpen(false);
    window.setTimeout(() => customerPickerButtonRef.current?.click(), 0);
  }

  function openAdjustments() {
    setDraftDiscountType(discountType);
    setDraftDiscountValue(discountValue);
    setDraftDiscountReference(discountReference);
    setDraftCatalogDiscountId(catalogDiscountId);
    setDraftLoyaltyPoints(loyaltyPoints);
    setAdjustmentTab(Number(loyaltyPoints) > 0 ? "POINTS" : "DISCOUNT");
    setAdjustmentsOpen(true);
  }

  function applyAdjustments() {
    if (draftDiscountReferenceError || draftRedemption.error) return;
    setDiscountType(draftDiscountType);
    setDiscountValue(draftDiscountValue);
    setDiscountReference(draftDiscountReference);
    setCatalogDiscountId(draftCatalogDiscountId);
    setLoyaltyPoints(String(draftRedemption.points));
    setAdjustmentsOpen(false);
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
      cashReceivedRef.current?.click();
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
    setDiscountReference("");
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

      <aside
        aria-label="Current sale"
        className={`${styles.orderPanel} ${lines.length ? "" : styles.orderPanelEmpty}`}
      >
        <header className={styles.orderHeader}>
          <div>
            <span>CURRENT SALE</span>
            <h2>{totalItems ? `${totalItems} ${totalItems === 1 ? "item" : "items"}` : "New sale"}</h2>
          </div>
          {lines.length ? <button onClick={() => setLines([])} type="button">Clear</button> : null}
        </header>

        <div className={styles.customerArea}>
          <PackageCustomerPicker
            buttonRef={customerPickerButtonRef}
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
            aria-haspopup="dialog"
            className={styles.adjustmentsToggle}
            onClick={openAdjustments}
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
            <b>{totalDiscount > 0 ? "Edit" : "+"}</b>
          </button>
        </section>

        <div className={styles.orderSummary}>
          <div><span>Subtotal</span><strong>{formatMoney(tax.subtotal)}</strong></div>
          {manualDiscount > 0 ? (
            <div><span>{selectedCatalogDiscount?.name ?? "Discount"}</span><strong>−{formatMoney(manualDiscount)}</strong></div>
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
                  window.requestAnimationFrame(() => cashReceivedRef.current?.click());
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
        <input name="discountReference" type="hidden" value={discountReference} />
        <input name="catalogDiscountId" type="hidden" value={catalogDiscountId} />
        <input name="loyaltyPoints" type="hidden" value={redemption.points} />
        {paymentMethod === "CASH" ? (
          <div className={styles.cashTender}>
            <label>
              <span>Cash received</span>
              <MoneyNumpadInput
                aria-invalid={!cashPaymentReady}
                amountDue={tax.total}
                onValueChange={setCashReceived}
                placeholder={formatMoney(tax.total)}
                ref={cashReceivedRef}
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
    {adjustmentsOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.adjustmentBackdrop}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setAdjustmentsOpen(false);
            }}
          >
            <section
              aria-label="Discount and rewards"
              aria-modal="true"
              className={styles.adjustmentDialog}
              role="dialog"
            >
              <header className={styles.adjustmentDialogHeader}>
                <div>
                  <span>ORDER ADJUSTMENT</span>
                  <h2>Discount &amp; rewards</h2>
                </div>
                <button
                  aria-label="Close discount and rewards"
                  className={styles.adjustmentDialogClose}
                  onClick={() => setAdjustmentsOpen(false)}
                  type="button"
                >
                  &times;
                </button>
              </header>

              <div aria-label="Adjustment type" className={styles.adjustmentTabs} role="tablist">
                <button
                  aria-selected={adjustmentTab === "DISCOUNT"}
                  className={adjustmentTab === "DISCOUNT" ? styles.activeAdjustmentTab : ""}
                  onClick={() => setAdjustmentTab("DISCOUNT")}
                  role="tab"
                  type="button"
                >
                  Discount
                </button>
                <button
                  aria-selected={adjustmentTab === "POINTS"}
                  className={adjustmentTab === "POINTS" ? styles.activeAdjustmentTab : ""}
                  onClick={() => setAdjustmentTab("POINTS")}
                  role="tab"
                  type="button"
                >
                  TETAMU Points
                </button>
              </div>

              <div className={styles.adjustmentDialogBody}>
                {adjustmentTab === "DISCOUNT" ? (
                  <div className={styles.adjustmentContent}>
                    {catalogDiscounts.length ? (
                      <label className={styles.adjustmentField}>
                        <span>Catalog discount</span>
                        <select
                          onChange={(event) => {
                            const nextId = event.target.value;
                            setDraftCatalogDiscountId(nextId);
                            if (nextId) {
                              setDraftDiscountValue("0");
                              const selected = catalogDiscounts.find((item) => item.id === nextId);
                              if (selected && !selected.allowLoyaltyStacking) setDraftLoyaltyPoints("0");
                            }
                          }}
                          value={draftCatalogDiscountId}
                        >
                          <option value="">Manual discount</option>
                          {catalogDiscounts.map((discount) => (
                            <option key={discount.id} value={discount.id}>
                              {discount.name} · {formatCatalogDiscountValue(discount)} · {formatCatalogDiscountScope(discount.scope)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <div aria-label="Discount type" className={styles.adjustmentMode}>
                      <button
                        className={draftDiscountType === "AMOUNT" ? styles.activeAdjustmentMode : ""}
                        disabled={Boolean(draftCatalogDiscountId)}
                        onClick={() => setDraftDiscountType("AMOUNT")}
                        type="button"
                      >
                        RM amount
                      </button>
                      <button
                        className={draftDiscountType === "PERCENT" ? styles.activeAdjustmentMode : ""}
                        disabled={Boolean(draftCatalogDiscountId)}
                        onClick={() => setDraftDiscountType("PERCENT")}
                        type="button"
                      >
                        Percentage
                      </button>
                    </div>

                    <label className={styles.adjustmentField}>
                      <span>{draftDiscountType === "PERCENT" ? "Discount percentage" : "Discount amount"}</span>
                      <MoneyNumpadInput
                        aria-label="Discount value"
                        amountDue={draftDiscountType === "PERCENT" ? 100 : subtotal}
                        amountLabel="Maximum"
                        dialogEyebrow="ORDER ADJUSTMENT"
                        dialogTitle={draftDiscountType === "PERCENT" ? "Discount percentage" : "Discount amount"}
                        disabled={Boolean(draftCatalogDiscountId)}
                        exactLabel="Maximum"
                        onValueChange={setDraftDiscountValue}
                        placeholder={draftDiscountType === "PERCENT" ? "0%" : "RM0.00"}
                        prefix={draftDiscountType === "PERCENT" ? "" : "RM"}
                        suffix={draftDiscountType === "PERCENT" ? "%" : ""}
                        value={draftDiscountValue}
                      />
                    </label>

                    <label className={styles.adjustmentField}>
                      <span>Reference</span>
                      <input
                        maxLength={160}
                        onChange={(event) => setDraftDiscountReference(event.target.value)}
                        placeholder="e.g. Promotion code or manager approval"
                        value={draftDiscountReference}
                      />
                    </label>
                  </div>
                ) : (
                  <div className={styles.adjustmentContent}>
                    <button
                      aria-label={customer ? "Change loyalty customer" : "Select a customer to redeem points"}
                      className={`${styles.pointsAccount} ${styles.pointsAccountAction}`}
                      onClick={openCustomerPickerFromRewards}
                      type="button"
                    >
                      <div>
                        <strong>{customer?.name ?? "Select a customer"}</strong>
                        <small>
                          {customer
                            ? `${customer.phone} · Loyalty member`
                            : "A customer account is required to redeem points."}
                        </small>
                      </div>
                      <b>{customer ? `${customer.loyaltyPoints ?? 0} pts` : "Required"}</b>
                    </button>

                    <div className={styles.pointsInputRow}>
                      <label className={styles.adjustmentField}>
                        <span>Points to redeem</span>
                        <MoneyNumpadInput
                          aria-label="Points to redeem"
                          amountDue={customer?.loyaltyPoints ?? 0}
                          amountLabel="Available"
                          decimalPlaces={0}
                          dialogEyebrow="LOYALTY REWARD"
                          dialogTitle="Points to redeem"
                          disabled={!customer || !loyaltySettings.redemptionEnabled}
                          exactLabel="Maximum"
                          onValueChange={setDraftLoyaltyPoints}
                          placeholder="0 pts"
                          prefix=""
                          suffix=" pts"
                          value={draftLoyaltyPoints}
                        />
                      </label>
                      <button
                        className={styles.maximumPointsButton}
                        disabled={!customer || !loyaltySettings.redemptionEnabled}
                        onClick={useMaximumPoints}
                        type="button"
                      >
                        Use maximum
                      </button>
                    </div>

                    <div className={styles.savtNotice}>
                      <span>
                        <strong>SAVT rewards</strong>
                        <small>External rewards are not connected yet.</small>
                      </span>
                      <b>Unavailable</b>
                    </div>
                  </div>
                )}

                <div className={styles.adjustmentPreview}>
                  <div><span>Subtotal</span><strong>{formatMoney(draftTax.subtotal)}</strong></div>
                  {draftManualDiscount > 0 ? (
                    <div><span>{draftCatalogDiscount?.name ?? "Manual discount"}</span><strong>−{formatMoney(draftManualDiscount)}</strong></div>
                  ) : null}
                  {draftLoyaltyDiscount > 0 ? (
                    <div>
                      <span>TETAMU Points ({draftRedemption.points} pts)</span>
                      <strong>−{formatMoney(draftLoyaltyDiscount)}</strong>
                    </div>
                  ) : null}
                  {taxSettings.enabled ? (
                    <div>
                      <span>{formatTaxLabel(draftTax.taxLabel, draftTax.taxRate)}</span>
                      <strong>{formatMoney(draftTax.tax)}</strong>
                    </div>
                  ) : null}
                  <div className={styles.adjustmentPreviewTotal}>
                    <span>New total</span>
                    <strong>{formatMoney(draftTax.total)}</strong>
                  </div>
                </div>

                {draftDiscountReferenceError || draftRedemption.error ? (
                  <p className={styles.adjustmentDialogError}>
                    {draftDiscountReferenceError || draftRedemption.error}
                  </p>
                ) : null}
              </div>

              <footer className={styles.adjustmentDialogActions}>
                <button onClick={() => setAdjustmentsOpen(false)} type="button">Cancel</button>
                <button
                  disabled={Boolean(draftDiscountReferenceError || draftRedemption.error)}
                  onClick={applyAdjustments}
                  type="button"
                >
                  Apply
                </button>
              </footer>
            </section>
          </div>,
          document.body,
        )
      : null}
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
