"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal, useFormStatus } from "react-dom";
import type { CashierSaleInvoiceSummary, CashierSaleState } from "@/app/(business)/cashier/actions";
import { startShiftAction } from "@/app/(business)/closing/actions";
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
import { RECENT_CATALOG_CATEGORY } from "@/lib/cashier/catalog";
import {
  calculateCatalogDiscountCents,
  formatCatalogDiscountScope,
  formatCatalogDiscountValue,
  type CatalogDiscountOption,
} from "@/lib/catalog-discounts";
import { calculateLoyaltyRedemption } from "@/lib/loyalty/rules";
import { calculateTax, type TaxDisplaySettings } from "@/lib/tax/calculator";

export type CashierCartLine = CashierCatalogItem & { quantity: number };

export type CashierInitialSale = {
  appointmentId: string;
  assignedStaffId: string;
  customer: PackageCustomerOption;
  lines: CashierCartLine[];
  returnTo: string;
};

export type CashierStaffOption = {
  id: string;
  name: string;
};

export type CashierBranchOption = {
  id: string;
  name: string;
};

type CustomerPackageBalanceOption = {
  id: string;
  customerPackageId: string;
  name: string;
  remainingUses: number;
  serviceId: string;
  serviceName: string;
  totalUses: number;
};

type CashierUnifiedSaleFormProps = {
  action: (formData: FormData) => Promise<CashierSaleState>;
  appointmentError?: string | null;
  branchId: string;
  branches: CashierBranchOption[];
  catalogDiscounts: CatalogDiscountOption[];
  hasOpenShift: boolean;
  initialCatalog: CashierCatalogResult;
  initialCatalogType: "package" | "product" | "service";
  initialSale?: CashierInitialSale | null;
  staffOptions: CashierStaffOption[];
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
  appointmentError = null,
  branchId,
  branches,
  catalogDiscounts,
  hasOpenShift,
  initialCatalog,
  initialCatalogType,
  initialSale = null,
  staffOptions,
  taxSettings,
  loyaltySettings,
}: CashierUnifiedSaleFormProps) {
  const router = useRouter();
  const [appointmentSale] = useState(initialSale);
  const [catalogType, setCatalogType] = useState<CashierCatalogType>(initialCatalogType);
  const [category, setCategory] = useState("All categories");
  const [customer, setCustomer] = useState<PackageCustomerOption | null>(
    appointmentSale?.customer ?? null,
  );
  const [lines, setLines] = useState<CashierCartLine[]>(appointmentSale?.lines ?? []);
  const [assignedStaffId, setAssignedStaffId] = useState(
    appointmentSale?.assignedStaffId ?? "",
  );
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [cashReceived, setCashReceived] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const activeModal = shiftModalOpen ? "shift" : paymentOpen ? "payment" : null;
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
  const [availableCustomerPackages, setAvailableCustomerPackages] = useState<CustomerPackageBalanceOption[]>([]);
  const [selectedCustomerPackageIds, setSelectedCustomerPackageIds] = useState<string[]>([]);
  const [customerPackagesLoading, setCustomerPackagesLoading] = useState(false);
  const [customerPackagesError, setCustomerPackagesError] = useState("");
  const skipInitialRequest = useRef(true);
  const cashReceivedRef = useRef<HTMLInputElement>(null);
  const customerPickerButtonRef = useRef<HTMLButtonElement>(null);
  const categories = [
    RECENT_CATALOG_CATEGORY,
    "All categories",
    ...catalogData.categories.filter(
      (option) => option !== RECENT_CATALOG_CATEGORY && option !== "All categories",
    ),
  ];
  const currentCatalogPage = catalogData.page;
  const catalogPageCount = catalogData.pageCount;
  const visibleItems = catalogData.items;
  const shiftReturnPath = appointmentSale
    ? `/cashier?appointmentId=${encodeURIComponent(appointmentSale.appointmentId)}`
    : "/cashier";
  const shiftDraftKey = `cashier-shift-draft:${appointmentSale?.appointmentId ?? "direct"}`;
  const operationStorageKey = `cashier-operation:${appointmentSale?.appointmentId ?? "direct"}`;
  const [operationId, setOperationId] = useState("");

  useEffect(() => {
    const stored = window.sessionStorage.getItem(operationStorageKey);
    if (stored) {
      setOperationId(stored);
      return;
    }
    const created = `checkout:${crypto.randomUUID()}`;
    setOperationId(created);
    window.sessionStorage.setItem(operationStorageKey, created);
  }, [operationId, operationStorageKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    setCatalogData(initialCatalog);
  }, [initialCatalog]);

  useEffect(() => {
    const rawDraft = window.sessionStorage.getItem(shiftDraftKey);
    if (!rawDraft) return;

    window.sessionStorage.removeItem(shiftDraftKey);
    try {
      const draft = JSON.parse(rawDraft) as {
        assignedStaffId?: unknown;
        customer?: unknown;
        lines?: unknown;
      };
      if (Array.isArray(draft.lines)) {
        setLines(draft.lines as CashierCartLine[]);
      }
      if (draft.customer && typeof draft.customer === "object") {
        setCustomer(draft.customer as PackageCustomerOption);
      }
      if (typeof draft.assignedStaffId === "string") {
        setAssignedStaffId(draft.assignedStaffId);
      }
    } catch {
      // Ignore an invalid one-time browser draft and use the server-loaded sale.
    }
  }, [shiftDraftKey]);

  useEffect(() => {
    if (!activeModal) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (activeModal === "shift") {
        setShiftModalOpen(false);
        return;
      }
      setPaymentOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [activeModal]);

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

  const serviceIdsKey = useMemo(
    () => lines
      .filter((line) => line.type === "service")
      .map((line) => line.id)
      .sort()
      .join(","),
    [lines],
  );

  useEffect(() => {
    setSelectedCustomerPackageIds([]);
    setCustomerPackagesError("");

    if (!customer || !serviceIdsKey) {
      setAvailableCustomerPackages([]);
      setCustomerPackagesLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ branchId, customerId: customer.id });
    serviceIdsKey.split(",").forEach((serviceId) => params.append("serviceId", serviceId));
    setCustomerPackagesLoading(true);

    fetch(`/api/cashier/customer-packages?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as {
          error?: string;
          packages?: CustomerPackageBalanceOption[];
        };
        if (!response.ok) throw new Error(payload.error || "Unable to load customer packages.");
        setAvailableCustomerPackages(payload.packages ?? []);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setAvailableCustomerPackages([]);
        setCustomerPackagesError(
          error instanceof Error ? error.message : "Unable to load customer packages.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCustomerPackagesLoading(false);
      });

    return () => controller.abort();
  }, [branchId, customer, serviceIdsKey]);

  const hasPackages = lines.some((line) => line.type === "package");
  const hasServices = lines.some((line) => line.type === "service");
  const requiresCustomer = hasPackages || hasServices;
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

  const selectedCustomerPackages = availableCustomerPackages.filter((option) =>
    selectedCustomerPackageIds.includes(option.id),
  );
  const selectedPackageApplications = selectedCustomerPackages.flatMap((option) => {
    const lineIndex = lines.findIndex(
      (line) => line.type === "service" && line.id === option.serviceId,
    );
    if (lineIndex < 0) return [];

    const quantity = Math.max(1, lines[lineIndex].quantity);
    const coveredAmount = Math.max(
      0,
      lines[lineIndex].price
        - (tax.lineDiscount[lineIndex] ?? 0) / quantity
        + (tax.lineTax[lineIndex] ?? 0) / quantity,
    );
    if (coveredAmount <= 0) return [];

    return [{ ...option, coveredAmount }];
  });
  const packageCoverage = selectedPackageApplications.reduce(
    (sum, option) => sum + option.coveredAmount,
    0,
  );
  const amountDue = Math.max(0, tax.total - packageCoverage);

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

  const totalCents = Math.max(0, Math.round(amountDue * 100));
  const cashReceivedCents = Math.max(0, Math.round((Number(cashReceived) || 0) * 100));
  const cashPaymentReady = paymentMethod !== "CASH" || totalCents === 0 || cashReceivedCents >= totalCents;
  const cashChange = Math.max(0, cashReceivedCents - totalCents) / 100;
  const paymentReferenceReady = paymentMethod === "CASH" || Boolean(paymentReference.trim());
  const cashSuggestions = useMemo(() => {
    const exact = amountDue;
    const roundedFive = Math.ceil(exact / 5) * 5;
    const roundedTen = Math.ceil(exact / 10) * 10;
    return Array.from(new Set([exact, roundedFive, roundedTen].map((value) => value.toFixed(2))));
  }, [amountDue]);

  const canPay = Boolean(
    lines.length &&
      (!requiresCustomer || customer) &&
      (!hasServices || assignedStaffId) &&
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

  function openPayment() {
    if (!canPay) return;
    if (!hasOpenShift) {
      setShiftModalOpen(true);
      return;
    }
    setSaleError("");
    setPaymentOpen(true);
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
      setSaleError(`Enter at least ${formatMoney(amountDue)} cash received.`);
      cashReceivedRef.current?.click();
      return;
    }

    const result = await action(formData);

    if (result.status !== "success" || !result.invoice) {
      setSaleError(result.message || "Unable to complete cashier sale.");
      return;
    }

    setCompletedInvoice(result.invoice);
    window.sessionStorage.removeItem(operationStorageKey);
    setOperationId(`checkout:${crypto.randomUUID()}`);
    if (!appointmentSale) {
      setLines([]);
      setCustomer(null);
      setAssignedStaffId("");
      setCustomerPickerKey((key) => key + 1);
    }
    setDiscountType("AMOUNT");
    setDiscountValue("0");
    setDiscountReference("");
    setLoyaltyPoints("0");
    setAdjustmentsOpen(false);
    setCashReceived("");
    setPaymentReference("");
    setSelectedCustomerPackageIds([]);
    setAvailableCustomerPackages([]);
    setPaymentOpen(false);
    if (!appointmentSale) {
      router.refresh();
    }
  }

  function saveShiftDraft() {
    window.sessionStorage.setItem(
      shiftDraftKey,
      JSON.stringify({ assignedStaffId, customer, lines }),
    );
  }

  return (
    <>
      {appointmentError && !completedInvoice ? <div className="error">{appointmentError}</div> : null}
      {!hasOpenShift && !completedInvoice ? (
        <div className={styles.shiftNotice} role="alert">
          <span>Start a cashier shift before completing a sale.</span>
          <button onClick={() => setShiftModalOpen(true)} type="button">Start shift</button>
        </div>
      ) : null}
      <form action={submitSale} className={`${styles.posShell} ${styles.formalShell}`}>
      <input name="operationId" type="hidden" value={operationId} />
      <section aria-label="Sale catalog" className={styles.catalogPanel}>
        <header className={styles.panelHeader}>
          <div>
            <span>SALE CATALOG</span>
            <h2>Services, products and packages</h2>
          </div>
          <label className={styles.searchField}>
            <input
              aria-label="Search catalog"
              onChange={(event) => {
                setQuery(event.target.value);
                setCatalogPage(1);
              }}
              placeholder="Search service, product, package, SKU, or category"
              value={query}
            />
          </label>
        </header>

        <div className={styles.catalogTabs} role="tablist">
          {(["service", "product", "package"] as CashierCatalogType[]).map((option) => (
            <button
              aria-selected={catalogType === option}
              className={catalogType === option ? styles.activeTab : ""}
              key={option}
              onClick={() => switchCatalog(option)}
              role="tab"
              type="button"
            >
              {option === "service"
                ? "Services"
                : option === "product"
                  ? "Products"
                  : "Packages"}
            </button>
          ))}
        </div>

        <div
          aria-label="Catalog categories"
          className={styles.categoryBar}
          onWheel={(event) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;

            event.currentTarget.scrollLeft += event.deltaY;
            event.preventDefault();
          }}
        >
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
          {lines.length ? (
            <button
              onClick={() => {
                setLines([]);
                if (!appointmentSale) setAssignedStaffId("");
              }}
              type="button"
            >
              Clear
            </button>
          ) : null}
        </header>

        <div className={styles.customerArea}>
          <PackageCustomerPicker
            buttonRef={customerPickerButtonRef}
            buttonClassName={`${styles.customerButton} ${requiresCustomer && !customer ? styles.customerRequired : ""}`}
            compactAccountNote
            includeVehicleDetails={false}
            initialCustomer={appointmentSale?.customer}
            key={customerPickerKey}
            onSelectionChange={(nextCustomer) => {
              setCustomer(nextCustomer);
              if (!nextCustomer) setLoyaltyPoints("0");
            }}
            posDisplay
            readOnly={Boolean(appointmentSale)}
            required={requiresCustomer}
          />
        </div>

        {hasServices && !appointmentSale ? (
          <label className={`${styles.staffArea} ${!assignedStaffId ? styles.staffRequired : ""}`}>
            <span>
              <strong>Service staff</strong>
              <small>Used for commission and service reporting.</small>
            </span>
            <select
              onChange={(event) => setAssignedStaffId(event.target.value)}
              required
              value={assignedStaffId}
            >
              <option value="">Select staff</option>
              {staffOptions.map((staff) => (
                <option key={staff.id} value={staff.id}>
                  {staff.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

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

        <input name="method" type="hidden" value={paymentMethod} />
        <input name="discountType" type="hidden" value={discountType} />
        <input name="discountValue" type="hidden" value={numericDiscountValue} />
        <input name="discountReference" type="hidden" value={discountReference} />
        <input name="catalogDiscountId" type="hidden" value={catalogDiscountId} />
        <input name="loyaltyPoints" type="hidden" value={redemption.points} />
        <input name="assignedStaffId" type="hidden" value={assignedStaffId} />
        {selectedCustomerPackageIds.map((customerPackageId) => (
          <input
            key={customerPackageId}
            name="customerPackageId"
            type="hidden"
            value={customerPackageId}
          />
        ))}
        {hasStockError ? <p className={styles.submitMessage}>A product quantity exceeds available stock.</p> : null}
        <button
          className={styles.payButton}
          disabled={!canPay}
          onClick={openPayment}
          type="button"
        >
          {requiresCustomer && !customer
            ? "Select customer to continue"
            : hasServices && !assignedStaffId
              ? "Select service staff to continue"
            : `Payment · ${formatMoney(amountDue)}`}
        </button>
        <input name="branchId" type="hidden" value={branchId} />
        {appointmentSale ? (
          <input name="appointmentId" type="hidden" value={appointmentSale.appointmentId} />
        ) : null}
      </aside>

      {paymentOpen ? (
        <div
          className={styles.paymentBackdrop}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPaymentOpen(false);
          }}
        >
          <section aria-label="Payment" aria-modal="true" className={styles.paymentDialog} role="dialog">
            <header className={styles.paymentHeader}>
              <div>
                <span>CHECKOUT</span>
                <h2>Payment</h2>
              </div>
              <button aria-label="Close payment" onClick={() => setPaymentOpen(false)} type="button">×</button>
            </header>

            <div className={styles.paymentBody}>
              <div className={styles.paymentControls}>
                <section className={styles.paymentAmount}>
                  <span>Balance to pay</span>
                  <strong>{formatMoney(amountDue)}</strong>
                  <small>{totalItems} {totalItems === 1 ? "item" : "items"}</small>
                </section>

                {customer && serviceIdsKey ? (
                  <section className={styles.customerPackagePanel}>
                    <header>
                      <div>
                        <strong>Customer packages</strong>
                        <small>Use a purchased package for a matching service.</small>
                      </div>
                      {selectedCustomerPackages.length ? (
                        <span>{selectedCustomerPackages.length} selected</span>
                      ) : null}
                    </header>
                    {customerPackagesLoading ? (
                      <p>Checking available packages...</p>
                    ) : customerPackagesError ? (
                      <p className={styles.customerPackageError}>{customerPackagesError}</p>
                    ) : availableCustomerPackages.length ? (
                      <div className={styles.customerPackageOptions}>
                        {availableCustomerPackages.map((option) => {
                          const selected = selectedCustomerPackageIds.includes(option.id);
                          return (
                            <button
                              aria-pressed={selected}
                              className={selected ? styles.customerPackageSelected : ""}
                              key={option.id}
                              onClick={() => {
                                setSelectedCustomerPackageIds((current) => {
                                  if (current.includes(option.id)) {
                                    return current.filter((id) => id !== option.id);
                                  }
                                  const sameServiceIds = new Set(
                                    availableCustomerPackages
                                      .filter((item) => item.serviceId === option.serviceId)
                                      .map((item) => item.id),
                                  );
                                  return [
                                    ...current.filter((id) => !sameServiceIds.has(id)),
                                    option.id,
                                  ];
                                });
                                setCashReceived("");
                              }}
                              type="button"
                            >
                              <span>
                                <strong>{option.name}</strong>
                                <small>{option.serviceName}</small>
                              </span>
                              <b>{option.remainingUses}/{option.totalUses} uses</b>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p>No purchased package matches these services.</p>
                    )}
                  </section>
                ) : null}

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

                <section className={styles.paymentSection}>
                  <h3>Payment method</h3>
                  <div aria-label="Payment method" className={styles.paymentChoices}>
                    {paymentMethods.map((method) => (
                      <button
                        className={paymentMethod === method.value ? styles.activePaymentChoice : ""}
                        key={method.value}
                        onClick={() => {
                          setPaymentMethod(method.value);
                          setSaleError("");
                        }}
                        type="button"
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>
                </section>

                {paymentMethod === "CASH" ? (
                  <section className={styles.paymentSection}>
                    <h3>Cash received</h3>
                    <div className={styles.cashSuggestions}>
                      {cashSuggestions.map((amount, index) => (
                        <button
                          className={cashReceived === amount ? styles.activeCashSuggestion : ""}
                          key={amount}
                          onClick={() => setCashReceived(amount)}
                          type="button"
                        >
                          {index === 0 ? "Exact " : ""}{formatMoney(Number(amount))}
                        </button>
                      ))}
                      <button onClick={() => cashReceivedRef.current?.click()} type="button">Custom</button>
                    </div>
                    <div className={styles.cashTender}>
                      <label>
                        <span>Amount received</span>
                        <MoneyNumpadInput
                          aria-invalid={!cashPaymentReady}
                          amountDue={amountDue}
                          onValueChange={setCashReceived}
                          placeholder={formatMoney(amountDue)}
                          ref={cashReceivedRef}
                          value={cashReceived}
                        />
                      </label>
                      <div className={styles.cashChange}>
                        <span>Change</span>
                        <strong>{formatMoney(cashChange)}</strong>
                      </div>
                    </div>
                  </section>
                ) : (
                  <label className={`${styles.referenceField} ${styles.paymentReferenceField}`}>
                    <span>Payment reference</span>
                    <input
                      maxLength={120}
                      name="reference"
                      onChange={(event) => setPaymentReference(event.target.value)}
                      placeholder="Enter transaction reference"
                      required
                      value={paymentReference}
                    />
                  </label>
                )}
              </div>

              <aside className={styles.paymentOrder}>
                <header>
                  <div>
                    <span>ORDER SUMMARY</span>
                    <h3>{customer?.name ?? "Walk-in customer"}</h3>
                  </div>
                  {customer ? <small>{customer.phone}</small> : null}
                </header>
                <div className={styles.paymentOrderLines}>
                  {lines.map((line) => (
                    <div className={styles.paymentOrderLine} key={`${line.type}-${line.id}`}>
                      <div>
                        <strong>{line.name}</strong>
                        <small>{line.type === "package" ? "Package" : line.type === "service" ? "Service" : formatMoney(line.price)}</small>
                      </div>
                      <span>×{line.quantity}</span>
                      <strong>{formatMoney(line.price * line.quantity)}</strong>
                    </div>
                  ))}
                </div>
                <div className={styles.paymentOrderTotals}>
                  <div><span>Subtotal</span><strong>{formatMoney(tax.subtotal)}</strong></div>
                  {totalDiscount > 0 ? <div><span>Discount</span><strong>−{formatMoney(totalDiscount)}</strong></div> : null}
                  {taxSettings.enabled ? <div><span>{formatTaxLabel(tax.taxLabel, tax.taxRate)}</span><strong>{formatMoney(tax.tax)}</strong></div> : null}
                  {selectedPackageApplications.map((option) => (
                    <div className={styles.packageCoverageRow} key={option.id}>
                      <span>{option.serviceName} · Package voucher</span>
                      <strong>−{formatMoney(option.coveredAmount)}</strong>
                    </div>
                  ))}
                  <div><span>Total</span><strong>{formatMoney(tax.total)}</strong></div>
                  {packageCoverage > 0 ? (
                    <div className={styles.amountDueRow}><span>Amount due</span><strong>{formatMoney(amountDue)}</strong></div>
                  ) : null}
                </div>
              </aside>
            </div>

            {saleError ? <p className={styles.paymentError}>{saleError}</p> : null}
            <footer className={styles.paymentFooter}>
              <button onClick={() => setPaymentOpen(false)} type="button">Back</button>
              <CashierPayButton
                canPay={canPay && cashPaymentReady && paymentReferenceReady}
                cashRequired={paymentMethod === "CASH" && !cashPaymentReady}
                referenceRequired={!paymentReferenceReady}
                total={amountDue}
              />
            </footer>
          </section>
        </div>
      ) : null}
      </form>
    {shiftModalOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className={styles.shiftModalBackdrop}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShiftModalOpen(false);
            }}
          >
            <section
              aria-label="Start shift"
              aria-modal="true"
              className={styles.shiftModalDialog}
              role="dialog"
            >
              <header className={styles.shiftModalHeader}>
                <div>
                  <span>CASHIER SHIFT</span>
                  <h2>Start shift</h2>
                </div>
                <button
                  aria-label="Close start shift"
                  onClick={() => setShiftModalOpen(false)}
                  type="button"
                >
                  &times;
                </button>
              </header>
              <form
                action={startShiftAction}
                className={styles.shiftModalForm}
                onSubmit={saveShiftDraft}
              >
                <input name="returnTo" type="hidden" value={shiftReturnPath} />
                <div className={styles.shiftModalFields}>
                  <label>
                    <span>Branch</span>
                    <select
                      defaultValue={branchId || (branches.length === 1 ? branches[0].id : "")}
                      name="branchId"
                      required
                    >
                      <option disabled value="">Select branch</option>
                      {branches.map((branch) => (
                        <option key={branch.id} value={branch.id}>
                          {branch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Opening cash float</span>
                    <input
                      defaultValue="0.00"
                      inputMode="decimal"
                      min="0"
                      name="openingFloat"
                      required
                      step="0.01"
                      type="number"
                    />
                  </label>
                </div>
                <footer className={styles.shiftModalFooter}>
                  <StartShiftButton disabled={!branches.length} />
                </footer>
              </form>
            </section>
          </div>,
          document.body,
        )
      : null}
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
        onDone={() => {
          setCompletedInvoice(null);
          window.location.replace("/cashier");
        }}
        onClose={() => {
          if (appointmentSale) {
            router.push(appointmentSale.returnTo);
            return;
          }
          setCompletedInvoice(null);
        }}
      />
    ) : null}
    </>
  );
}

function CashierPayButton({
  canPay,
  cashRequired,
  referenceRequired,
  total,
}: {
  canPay: boolean;
  cashRequired: boolean;
  referenceRequired: boolean;
  total: number;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={styles.paymentConfirmButton} disabled={!canPay || pending} type="submit">
      {pending
        ? "Processing..."
        : cashRequired
          ? "Enter cash received"
          : referenceRequired
            ? "Enter payment reference"
            : `Confirm payment · ${formatMoney(total)}`}
    </button>
  );
}

function StartShiftButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button disabled={disabled || pending} type="submit">
      {pending ? "Starting..." : "Start shift"}
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
