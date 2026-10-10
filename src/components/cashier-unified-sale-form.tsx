"use client";

import { PosOutletBranchField } from "@/components/pos-outlet-presentation";
import { MemberWalletSummary } from "@/components/wallet/member-wallet-summary";
import { walletPanelAction } from "@/app/(business)/crm/wallet/actions";
import { parseMoneyToCents } from "@/lib/commercial/money";
import { walletMoney } from "@/components/wallet/wallet-views";
import { CheckoutAttribution } from "@/components/performance/checkout-attribution";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal, useFormStatus } from "react-dom";
import type { CashierSaleInvoiceSummary, CashierSaleState } from "@/app/(business)/cashier/actions";
import { cashierActivityOptionsAction, cashierPointsOptionsAction } from "@/app/(business)/cashier/actions";
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
import { packageOptionDateLabels } from "@/lib/cashier/package-option-labels";
import {
  calculateCatalogDiscountCents,
  formatCatalogDiscountScope,
  formatCatalogDiscountValue,
  type CatalogDiscountOption,
} from "@/lib/catalog-discounts";
import { prepareCheckoutCoverage, calculateCoveredCheckoutTax, redeemCheckoutPoints } from "@/lib/loyalty/checkout-coverage";
import { type TaxDisplaySettings } from "@/lib/tax/calculator";
import { createWalletCheckoutIntent, readWalletCheckoutRecovery, reconfirmWalletCheckoutActivity, toWalletCheckoutFormData, type WalletCheckoutIntent } from "@/lib/wallet/checkout-intent";

export type CashierCartLine = CashierCatalogItem & { quantity: number };
type PointsRead = Extract<Awaited<ReturnType<typeof cashierPointsOptionsAction>>, {ok:true}>["data"];

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

export type CashierPaymentMethodOption = {
  id: string | null;
  code: string;
  label: string;
  canonicalMethod: "CASH" | "CARD" | "DUITNOW" | "EWALLET" | "BANK_TRANSFER" | "FOREIGN_CURRENCY" | "CRYPTO";
  paymentKind: "LOCAL_TENDER" | "FOREIGN_CURRENCY" | "CRYPTO_ASSET";
  settlementCurrency: string;
  assetSymbol: string | null;
  behavior: "STANDARD_TENDER" | "TRAINING_COMPLIMENTARY";
};

type CustomerPackageBalanceOption = {
  id: string;
  customerPackageId: string;
  purchasedAt?: string | null;
  name: string;
  remainingUses: number;
  serviceId: string;
  serviceName: string;
  totalUses: number;
};

type CashierUnifiedSaleFormProps = {
  singleOutlet?: boolean;
  walletCheckoutScope?: string;
  walletCheckoutEnabled?: boolean;
  action: (formData: FormData) => Promise<CashierSaleState>;
  appointmentError?: string | null;
  branchId: string;
  branches: CashierBranchOption[];
  catalogDiscounts: CatalogDiscountOption[];
  hasOpenShift: boolean;
  cashierShiftsEnabled?: boolean;
  shiftId?: string | null;
  initialCatalog: CashierCatalogResult;
  initialCatalogType: "package" | "product" | "service";
  initialSale?: CashierInitialSale | null;
  paymentMethods: CashierPaymentMethodOption[];
  staffOptions: CashierStaffOption[];
  taxSettings: TaxDisplaySettings;
  loyaltySettings: {
    enabled: boolean;
    redemptionEnabled: boolean;
    pointsPerRinggit: number;
    minimumPoints: number;
  };
};

export function CashierUnifiedSaleForm({
  singleOutlet = false,
  walletCheckoutScope,
  walletCheckoutEnabled = false,
  action,
  appointmentError = null,
  branchId,
  branches,
  catalogDiscounts,
  hasOpenShift,
  cashierShiftsEnabled = true,
  shiftId = null,
  initialCatalog,
  initialCatalogType,
  initialSale = null,
  paymentMethods,
  staffOptions,
  taxSettings,
  loyaltySettings: initialLoyaltySettings,
}: CashierUnifiedSaleFormProps) {
  const router = useRouter();
  const [walletAmount, setWalletAmount] = useState("");
  const [walletPending, setWalletPending] = useState<WalletCheckoutIntent | null>(null);
  const [walletRecoveryBlocked, setWalletRecoveryBlocked] = useState(false);
  const [walletSending, setWalletSending] = useState(false);
  const [walletRecoveryKey, setWalletRecoveryKey] = useState<string | null>(null);
  const walletSendLock = useRef(false);
  const walletScope = walletCheckoutScope ? `${walletCheckoutScope}:${branchId}` : "";
  const walletStorageKey = walletRecoveryKey ?? `wallet-checkout:${walletScope}`;
  useEffect(() => {
    if (!walletCheckoutScope) return;
    try {
      const recovery = readWalletCheckoutRecovery(sessionStorage, walletCheckoutScope);
      setWalletPending(recovery?.intent ?? null); setWalletRecoveryBlocked(recovery?.blocked ?? false);
      setWalletRecoveryKey(recovery?.key || null);
    } catch { setWalletRecoveryBlocked(true); }
  }, [walletCheckoutScope, branchId]);
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
  const [paymentMethodCode, setPaymentMethodCode] = useState(
    paymentMethods.find((method) => method.canonicalMethod === "CASH")?.code
      ?? paymentMethods[0]?.code
      ?? "",
  );
  const [cashReceived, setCashReceived] = useState("");
  const [performanceAvailable, setPerformanceAvailable] = useState(false);
  const [performanceTip, setPerformanceTip] = useState("0");
  const [paymentReference, setPaymentReference] = useState("");
  const [tenderAmount, setTenderAmount] = useState("");
  const [exchangeRateToMyr, setExchangeRateToMyr] = useState("");
  const [checkoutReason, setCheckoutReason] = useState("");
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
  const selectedPaymentMethod = paymentMethods.find(
    (method) => method.code === paymentMethodCode,
  ) ?? paymentMethods[0] ?? null;
  const paymentMethod = selectedPaymentMethod?.canonicalMethod ?? "CASH";
  const isTrainingComplimentary = selectedPaymentMethod?.behavior === "TRAINING_COMPLIMENTARY";
  const isConvertedTender = selectedPaymentMethod?.paymentKind === "FOREIGN_CURRENCY"
    || selectedPaymentMethod?.paymentKind === "CRYPTO_ASSET";
  const tenderSymbol = selectedPaymentMethod?.paymentKind === "CRYPTO_ASSET"
    ? selectedPaymentMethod.assetSymbol ?? "Asset"
    : selectedPaymentMethod?.settlementCurrency ?? "MYR";
  const currentCatalogPage = catalogData.page;
  const catalogPageCount = catalogData.pageCount;
  const visibleItems = catalogData.items;
  const shiftReturnPath = appointmentSale
    ? `/cashier?appointmentId=${encodeURIComponent(appointmentSale.appointmentId)}`
    : "/cashier";
  const shiftDraftKey = `cashier-shift-draft:${appointmentSale?.appointmentId ?? "direct"}`;
  const operationStorageKey = `cashier-operation:${appointmentSale?.appointmentId ?? "direct"}`;
  const [operationId, setOperationId] = useState("");
  const [reviewedActivity,setReviewedActivity]=useState<{modeAtConfirmation:"ON"|"OFF";branchId:string;shiftId:string|null}|null>(null);
  const regularConfirmation=useRef<{modeAtConfirmation:string;shiftId:string}|null>(null);
  const [regularPaymentSubmitted, setRegularPaymentSubmitted] = useState(false);
  const [paymentWallet, setPaymentWallet] = useState<{ scope: string; customerId: string; cents: number | null; error: boolean } | null>(null);
  const [walletReadRevision, setWalletReadRevision] = useState(0);
  const [walletExpanded, setWalletExpanded] = useState(false);
  const [customCashExpanded, setCustomCashExpanded] = useState(false);
  const [walletDraft, setWalletDraft] = useState("");
  const [walletDraftError, setWalletDraftError] = useState("");
  const [walletCardPosition, setWalletCardPosition] = useState<{left:number;top:number;width:number;maxHeight:number} | null>(null);
  const walletEntryRef = useRef<HTMLButtonElement>(null);
  const walletDraftRef = useRef<HTMLInputElement>(null);
  const walletCardRef = useRef<HTMLElement>(null);
  const [pointsRead, setPointsRead] = useState<PointsRead | null>(null);
  const [pointsReadError, setPointsReadError] = useState(false);
  const [pointsReadRevision, setPointsReadRevision] = useState(0);
  const [appliedPointsContext, setAppliedPointsContext] = useState<PointsRead | null>(null);
  const pointsSequence = useRef(0);
  const pointsRefreshRequested = useRef(false);
  const pointsCustomerId = useRef(customer?.id);
  pointsCustomerId.current = customer?.id;
  const freshPoints = pointsRead?.customerId === customer?.id ? pointsRead : null;
  const appliedPoints = appliedPointsContext?.customerId === customer?.id ? appliedPointsContext : null;
  const loyaltySettings = appliedPoints?.settings ?? initialLoyaltySettings;
  const draftUsesFreshPoints = pointsRefreshRequested.current;
  const draftPointsContext = draftUsesFreshPoints ? freshPoints : appliedPoints;
  const draftPointsSettings = draftPointsContext?.settings ?? loyaltySettings;
  const draftAvailablePoints = draftPointsContext?.availablePoints ?? (draftUsesFreshPoints ? 0 : customer?.loyaltyPoints ?? 0);
  const pointsEligible = !!customer && freshPoints?.membershipStatus === "ACTIVE" && freshPoints.settings.enabled && freshPoints.settings.redemptionEnabled;
  useEffect(() => {
    const sequence = ++pointsSequence.current;
    let cancelled = false;
    if (!adjustmentsOpen || adjustmentTab !== "POINTS" || !customer?.id) return;
    setPointsRead(null); setPointsReadError(false);
    const customerId = customer.id;
    void cashierPointsOptionsAction(customerId).then(result => {
      if (cancelled || sequence !== pointsSequence.current || pointsCustomerId.current !== customerId) return;
      if (!result.ok || result.data.customerId !== customerId) { setPointsReadError(true); return; }
      setPointsRead(result.data);
    }).catch(() => {
      if (!cancelled && sequence === pointsSequence.current && pointsCustomerId.current === customerId) setPointsReadError(true);
    });
    return () => { cancelled = true; };
  }, [adjustmentsOpen, adjustmentTab, customer?.id, pointsReadRevision]);
  function closeWalletCard() {
    setWalletExpanded(false);
    setWalletDraft("");
    setWalletDraftError("");
    walletEntryRef.current?.focus();
  }
  useEffect(() => {
    if (!walletExpanded) return;
    const position = () => {
      const anchor=walletEntryRef.current?.getBoundingClientRect();
      const card=walletCardRef.current;
      if (!anchor || !card) return;
      const parent=walletEntryRef.current?.closest('[aria-label="Payment"]');
      const header=parent?.querySelector('header')?.getBoundingClientRect();
      const footer=parent?.querySelector('footer')?.getBoundingClientRect();
      const width=Math.min(460,window.innerWidth-24);
      const minTop=Math.max(12,(header?.bottom??0)+8);
      const bottom=Math.min(window.innerHeight-12,footer && footer.top>minTop ? footer.top-8 : window.innerHeight-12);
      const maxHeight=Math.max(1,bottom-minTop);
      const height=Math.min(card.getBoundingClientRect().height,maxHeight);
      setWalletCardPosition({width,maxHeight,left:Math.max(12,Math.min(anchor.right-width,window.innerWidth-width-12)),top:Math.max(minTop,Math.min(anchor.bottom+8,bottom-height))});
    };
    const outside = (event:MouseEvent) => {
      if (event.target instanceof Node && !walletCardRef.current?.contains(event.target) && !walletEntryRef.current?.contains(event.target)) {
        event.preventDefault();event.stopPropagation();closeWalletCard();
      }
    };
    // Parent backdrop closes on mousedown; an outside gesture cancels only this popover.
    const outsidePress = (event:MouseEvent) => {
      if (event.target instanceof Node && !walletCardRef.current?.contains(event.target) && !walletEntryRef.current?.contains(event.target)) {
        event.preventDefault();event.stopPropagation();
      }
    };
    position();
    const observer=typeof ResizeObserver!=="undefined" ? new ResizeObserver(position) : null;
    if(walletCardRef.current)observer?.observe(walletCardRef.current);
    window.addEventListener('resize',position);window.addEventListener('scroll',position,true);document.addEventListener('mousedown',outsidePress,true);document.addEventListener('click',outside,true);
    return()=>{observer?.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);document.removeEventListener('mousedown',outsidePress,true);document.removeEventListener('click',outside,true);};
  }, [walletExpanded]);
  const walletCardPositioned = walletCardPosition !== null;
  useEffect(() => {
    if (walletExpanded && walletCardPositioned) { walletDraftRef.current?.focus(); walletDraftRef.current?.select(); }
  }, [walletExpanded, walletCardPositioned]);
  useEffect(() => {
    setWalletExpanded(false);
    setWalletDraft("");
  }, [paymentOpen, customer?.id, walletScope, walletPending, walletRecoveryBlocked]);
  const paymentCustomerId = customer?.id;
  useEffect(() => {
    let current = true;
    setPaymentWallet(null);
    if (!paymentOpen || !walletCheckoutEnabled || !walletScope || !paymentCustomerId) return;
    const unavailable = () => {
      if (current) setPaymentWallet({ scope: walletScope, customerId: paymentCustomerId, cents: null, error: true });
    };
    void walletPanelAction(paymentCustomerId).then(result => {
      if (!current) return;
      if (!result.ok) { unavailable(); return; }
      // Read-model returns decimal text. The existing cents parser avoids float arithmetic.
      const cents = parseMoneyToCents(result.data.totalBalance);
      if (cents === null) { unavailable(); return; }
      setPaymentWallet({ scope: walletScope, customerId: paymentCustomerId, cents, error: false });
    }).catch(unavailable);
    return () => { current = false; };
  }, [paymentOpen, walletCheckoutEnabled, walletScope, paymentCustomerId, walletReadRevision]);
  const currentPaymentWallet = paymentOpen && paymentWallet?.scope === walletScope && paymentWallet.customerId === paymentCustomerId ? paymentWallet : null;
  const availableWalletCents = currentPaymentWallet?.cents ?? null;

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
  const hasStockError = lines.some((line) =>
    line.type === "product" && line.stock !== undefined && line.quantity > line.stock,
  );
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
  const discountReferenceError = discountReference.trim().length > 160
    ? "Discount reference is too long."
    : "";
  const selectedCustomerPackages = useMemo(() => availableCustomerPackages.filter((option) =>
    selectedCustomerPackageIds.includes(option.id),
  ), [availableCustomerPackages, selectedCustomerPackageIds]);
  const customerPackageDateLabels = useMemo(() => packageOptionDateLabels(availableCustomerPackages), [availableCustomerPackages]);
  // Match the server's product / individual package purchase / service order
  // for voucher-aware allocation; keep the existing non-voucher preview intact.
  const coverageLines = useMemo(() => selectedCustomerPackages.length ? [
    ...lines.filter(line => line.type === "product"),
    ...lines.filter(line => line.type === "package").flatMap(line =>
      Array.from({ length: line.quantity }, () => ({ ...line, quantity: 1 }))),
    ...lines.filter(line => line.type === "service"),
  ] : lines, [lines, selectedCustomerPackages.length]);
  const coverageInput = useMemo(() => ({
    lines: coverageLines.map(line => ({
      lineTotal: line.price * line.quantity, quantity: line.quantity,
      coveredQuantity: line.type === "service" ? Math.min(line.quantity, selectedCustomerPackages.filter(option => option.serviceId === line.id).length) : 0,
      taxable: line.taxable, taxRate: line.taxRate,
    })),
    sstEnabled: taxSettings.enabled, sstLabel: taxSettings.label, sstRate: taxSettings.rate,
  }), [coverageLines, selectedCustomerPackages, taxSettings]);
  const eligibleCents = prepareCheckoutCoverage({ ...coverageInput, discount: manualDiscount }).eligibleCents;
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
      const result = redeemCheckoutPoints({
        availablePoints: appliedPoints?.availablePoints ?? customer.loyaltyPoints ?? 0,
        maximumDiscountCents: eligibleCents,
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
  }, [customer, loyaltyPoints, loyaltySettings, eligibleCents, selectedCatalogDiscount, appliedPoints]);
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
  const draftDiscountReferenceError = draftDiscountReference.trim().length > 160
    ? "Discount reference is too long."
    : "";
  const draftEligibleCents = prepareCheckoutCoverage({ ...coverageInput, discount: draftManualDiscount }).eligibleCents;
  const draftRedemption = useMemo(() => {
    if (draftUsesFreshPoints && !pointsEligible) return { discountCents: 0, error: "", points: 0 };
    const requestedPoints = Math.max(0, Math.floor(Number(draftLoyaltyPoints) || 0));
    if (!requestedPoints) return { discountCents: 0, error: "", points: 0 };
    if (!customer) {
      return { discountCents: 0, error: "Select a customer to use points.", points: 0 };
    }
    if (draftCatalogDiscount && !draftCatalogDiscount.allowLoyaltyStacking) {
      return { discountCents: 0, error: "This discount cannot be combined with loyalty points.", points: 0 };
    }
    if (!draftPointsSettings.enabled || !draftPointsSettings.redemptionEnabled) {
      return { discountCents: 0, error: "Point redemption is not enabled.", points: 0 };
    }

    try {
      const result = redeemCheckoutPoints({
        availablePoints: draftAvailablePoints,
        maximumDiscountCents: draftEligibleCents,
        minimumPoints: draftPointsSettings.minimumPoints,
        pointsPerRinggit: draftPointsSettings.pointsPerRinggit,
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
    draftEligibleCents,
    draftCatalogDiscount,
    draftPointsSettings,
    draftAvailablePoints,
    draftUsesFreshPoints,
    pointsEligible,
  ]);
  const draftLoyaltyDiscount = draftRedemption.discountCents / 100;

  const receivedTip = performanceAvailable && !isTrainingComplimentary ? Number(performanceTip || 0) : 0;
  const checkoutCalculation = useMemo(() => calculateCoveredCheckoutTax({
    ...coverageInput,
    discount: isTrainingComplimentary ? subtotal : manualDiscount,
    tip: receivedTip,
  }, isTrainingComplimentary ? 0 : redemption.discountCents), [coverageInput, isTrainingComplimentary, manualDiscount, subtotal, redemption.discountCents, receivedTip]);
  const tax = checkoutCalculation.tax;
  const selectedPackageApplications = selectedCustomerPackages.flatMap((option) => {
    const lineIndex = coverageLines.findIndex(
      (line) => line.type === "service" && line.id === option.serviceId,
    );
    if (lineIndex < 0) return [];

    const unitIndex = selectedCustomerPackages.filter(item => item.serviceId === option.serviceId).findIndex(item => item.id === option.id);
    const coveredAmount = (checkoutCalculation.coverageCents[lineIndex][unitIndex] ?? 0) / 100;
    if (coveredAmount <= 0) return [];

    return [{ ...option, coveredAmount }];
  });
  const packageCoverage = selectedPackageApplications.reduce(
    (sum, option) => sum + option.coveredAmount,
    0,
  );
  const amountDue = isTrainingComplimentary ? 0 : Math.max(0, tax.total - packageCoverage);

  const draftTax = useMemo(() => calculateCoveredCheckoutTax({
    ...coverageInput,
    discount: draftManualDiscount,
    tip: receivedTip,
  }, draftRedemption.discountCents).tax, [coverageInput, draftManualDiscount, draftRedemption.discountCents, receivedTip]);

  const totalCents = Math.max(0, Math.round(amountDue * 100));
  const walletAmountValid = /^\d+(?:\.\d{1,2})?$/.test(walletAmount);
  const walletCents = walletAmountValid ? Math.round(Number(walletAmount) * 100) : 0;
  const fullWallet = walletCents > 0 && walletCents === totalCents;
  const maxWalletCents = availableWalletCents === null ? null : Math.min(availableWalletCents, totalCents);
  let draftCents:number|null=null;
  let draftAmountError="";
  if(walletDraft!=="") {
    if (/^-\d+(?:\.\d{1,2})?$/.test(walletDraft)) draftAmountError="Enter an amount of RM0.00 or more.";
    else {
      try { draftCents=/^\d+(?:\.\d{1,2})?$/.test(walletDraft) ? parseMoneyToCents(walletDraft) : null; } catch { /* Invalid raw draft stays editable. */ }
      if(draftCents===null) draftAmountError="Enter a valid amount.";
      else if(draftCents>totalCents) draftAmountError=`Maximum wallet amount is ${formatMoney(totalCents/100)}.`;
      else if(draftCents>0 && availableWalletCents===null) draftAmountError="Wallet balance unavailable. Retry to use wallet funds.";
      else if(availableWalletCents!==null && draftCents>availableWalletCents) draftAmountError=`Available wallet balance is ${formatMoney(availableWalletCents/100)}.`;
    }
  }
  const draftEligibilityError=draftCents!==null && draftCents>0 && (isTrainingComplimentary || (isConvertedTender && draftCents!==totalCents) || selectedCustomerPackageIds.length>0)
    ? "Wallet requires a MYR sale without package redemption or Training / Complimentary." : "";
  const draftError=draftAmountError || draftEligibilityError || walletDraftError;
  const draftValid=draftCents!==null && !draftAmountError && !draftEligibilityError;
  const draftRemainingCents=Math.max(0,totalCents-(draftValid ? draftCents! : 0));
  function applyWalletDraft() {
    if(walletPending || walletRecoveryBlocked) return;
    if(!draftValid) { if(walletDraft==="")setWalletDraftError("Enter a valid amount.");return; }
    setWalletAmount(walletDraft);closeWalletCard();
  }
  const externalDue = Math.max(0, totalCents - walletCents) / 100;
  const walletReady = !walletAmount || (walletAmountValid && walletCents === 0) || (walletCheckoutEnabled && !!walletScope && !!customer && walletCents > 0 && walletCents <= totalCents
    && availableWalletCents !== null && walletCents <= availableWalletCents
    && !isTrainingComplimentary && (fullWallet || !isConvertedTender) && !selectedCustomerPackageIds.length);
  const cashReceivedCents = Math.max(0, Math.round((Number(cashReceived) || 0) * 100));
  const cashPaymentReady = fullWallet || paymentMethod !== "CASH" || totalCents === 0 || cashReceivedCents >= totalCents - walletCents;
  const cashChange = Math.max(0, cashReceivedCents - (totalCents - walletCents)) / 100;
  const tenderEquivalent = Math.max(0, Number(tenderAmount) || 0) * Math.max(0, Number(exchangeRateToMyr) || 0);
  const convertedTenderReady = fullWallet || !isConvertedTender || (
    Number(tenderAmount) > 0
    && Number(exchangeRateToMyr) > 0
    && Math.round(tenderEquivalent * 100) >= totalCents
  );
  const paymentReferenceReady = fullWallet || isTrainingComplimentary || paymentMethod === "CASH" || Boolean(paymentReference.trim());
  const trainingCheckoutReady = !isTrainingComplimentary || (
    checkoutReason.trim().length >= 5 &&
    lines.length > 0 &&
    lines.every((line) => line.type === "service")
  );
  const cashSuggestions = useMemo(() => {
    const exact = externalDue;
    const roundedFive = Math.ceil(exact / 5) * 5;
    const roundedTen = Math.ceil(exact / 10) * 10;
    return Array.from(new Set([exact, roundedFive, roundedTen].map((value) => value.toFixed(2))));
  }, [externalDue]);

  const canPay = Boolean(
    lines.length &&
      (!requiresCustomer || customer) &&
      (!hasServices || assignedStaffId) &&
      !hasStockError &&
      !discountReferenceError &&
      !redemption.error,
  );

  const maximumPoints = useMemo(() => {
    if (!pointsEligible || !freshPoints) return 0;
    return redeemCheckoutPoints({
      availablePoints: freshPoints.availablePoints,
      requestedPoints: freshPoints.availablePoints,
      maximumDiscountCents: draftEligibleCents,
      pointsPerRinggit: freshPoints.settings.pointsPerRinggit,
      // Preview/Apply retain their existing minimum and stacking validation.
      minimumPoints: 0,
    }).points;
  }, [pointsEligible, freshPoints, draftEligibleCents]);

  const pointsLocked = regularPaymentSubmitted || !!walletPending || walletRecoveryBlocked || walletSending || !!regularConfirmation.current || walletSendLock.current;
  const pointsUnavailableReason = !customer ? "Select a customer to use points."
    : pointsReadError ? "Unable to refresh points balance. Please try again."
    : !freshPoints ? "Refreshing points..."
    : freshPoints.membershipStatus !== "ACTIVE" ? "Points unavailable: membership is not active."
    : !freshPoints.settings.enabled ? "Points unavailable: the loyalty program is disabled."
    : !freshPoints.settings.redemptionEnabled ? "Points unavailable: redemption is disabled."
    : draftCatalogDiscount && !draftCatalogDiscount.allowLoyaltyStacking ? "This discount cannot be combined with loyalty points."
    : draftEligibleCents === 0 ? "Points are not needed for this order."
    : maximumPoints === 0 || maximumPoints < freshPoints.settings.minimumPoints ? "Not enough points to redeem."
    : "";
  const pointsControlsDisabled = !!pointsUnavailableReason || pointsLocked;

  function useMaximumPoints() { if (!pointsControlsDisabled) setDraftLoyaltyPoints(String(maximumPoints)); }

  function openCustomerPickerFromRewards() {
    setAdjustmentsOpen(false);
    window.setTimeout(() => customerPickerButtonRef.current?.click(), 0);
  }

  function openAdjustments() {
    pointsRefreshRequested.current = Number(loyaltyPoints) > 0;
    setPointsRead(null); setPointsReadError(false);
    setDraftDiscountType(discountType);
    setDraftDiscountValue(discountValue);
    setDraftDiscountReference(discountReference);
    setDraftCatalogDiscountId(catalogDiscountId);
    setDraftLoyaltyPoints(loyaltyPoints);
    setAdjustmentTab(Number(loyaltyPoints) > 0 ? "POINTS" : "DISCOUNT");
    setAdjustmentsOpen(true);
  }

  function applyAdjustments() {
    if (pointsLocked || regularConfirmation.current || walletSendLock.current) return;
    if ((adjustmentTab === "POINTS" || (draftUsesFreshPoints && Number(draftLoyaltyPoints) > 0)) && pointsControlsDisabled) return;
    if (draftDiscountReferenceError || draftRedemption.error) return;
    setDiscountType(draftDiscountType);
    setDiscountValue(draftDiscountValue);
    setDiscountReference(draftDiscountReference);
    setCatalogDiscountId(draftCatalogDiscountId);
    setLoyaltyPoints(String(draftRedemption.points));
    if (draftUsesFreshPoints && freshPoints) setAppliedPointsContext(freshPoints);
    setAdjustmentsOpen(false);
  }

  const discountRemovalLocked = regularPaymentSubmitted || !!walletPending || walletRecoveryBlocked || walletSending;
  function removeDiscount() {
    // Never edit a confirmed request, including the interval before React rerenders.
    if (discountRemovalLocked || regularConfirmation.current || walletSendLock.current) return;
    setCatalogDiscountId("");
    setDiscountType("AMOUNT");
    setDiscountValue("0");
    setDiscountReference("");
    setDraftCatalogDiscountId("");
    setDraftDiscountType("AMOUNT");
    setDraftDiscountValue("0");
    setDraftDiscountReference("");
    setAdjustmentsOpen(false);
  }

  function openPayment() {
    if (!canPay) return;
    if (cashierShiftsEnabled && !hasOpenShift) {
      setShiftModalOpen(true);
      return;
    }
    setSaleError("");
    setPaymentWallet(null);
    setWalletExpanded(false);
    setCustomCashExpanded(false);
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
    if (item.type === "product" && item.stock !== undefined && item.stock < 1) return;
    setLines((current) => {
      const existing = current.find((line) => line.type === item.type && line.id === item.id);
      if (!existing) return [...current, { ...item, quantity: 1 }];
      const maximum = item.type === "product" && item.stock !== undefined ? item.stock : 99;
      return current.map((line) =>
        line.type === item.type && line.id === item.id
          ? { ...line, quantity: Math.min(maximum || 1, line.quantity + 1) }
          : line,
      );
    });
  }

  function updateQuantity(index: number, requested: number) {
    const service = lines[index];
    if (service?.type === "service") {
      const matching = new Set(availableCustomerPackages.filter(option => option.serviceId === service.id).map(option => option.id));
      setSelectedCustomerPackageIds(current => {
        let retained = 0;
        return current.filter(id => !matching.has(id) || ++retained <= Math.max(0, requested));
      });
    }
    setLines((current) => {
      const selected = current[index];
      if (!selected) return current;
      if (requested < 1) return current.filter((_, lineIndex) => lineIndex !== index);
      const maximum = selected.type === "product" && selected.stock !== undefined ? selected.stock : 99;
      return current.map((line, lineIndex) =>
        lineIndex === index
          ? { ...line, quantity: Math.max(1, Math.min(maximum || 1, requested)) }
          : line,
      );
    });
  }

  async function submitSale(formData: FormData) {
    if (walletPending || walletRecoveryBlocked || walletSendLock.current) return;
    setSaleError("");
    if (!walletReady) { setSaleError("Check the wallet amount and payment combination."); return; }
    if (!trainingCheckoutReady) {
      setSaleError("Training / Complimentary requires service items only and a reason of at least 5 characters.");
      return;
    }
    if (!cashPaymentReady) {
      setSaleError(`Enter at least ${formatMoney(externalDue)} cash received.`);
      cashReceivedRef.current?.click();
      return;
    }
    if (!convertedTenderReady) {
      setSaleError(`Enter the ${tenderSymbol} amount received and its MYR rate.`);
      return;
    }

    let result: Awaited<ReturnType<typeof action>>;
    if (walletCents) {
      try {
        if (readWalletCheckoutRecovery(sessionStorage, walletCheckoutScope!)) { setWalletRecoveryBlocked(true); return; }
        const intent = createWalletCheckoutIntent(formData, walletScope, [
          { label: "Customer", value: customer?.name ?? "" },
          ...(!singleOutlet ? [{ label: "Branch", value: branches.find(row => row.id === branchId)?.name ?? branchId }] : []),
          ...lines.map(line => ({ label: line.name, value: `${line.quantity} × ${formatMoney(line.price)}` })),
          { label: "Total", value: formatMoney(amountDue) }, { label: "Wallet", value: formatMoney(walletCents / 100) },
          { label: "External payment", value: fullWallet ? "None" : `${selectedPaymentMethod?.label}: ${formatMoney(externalDue)}` },
          { label: "Reference", value: fullWallet ? "" : paymentReference },
          { label: "Appointment", value: appointmentSale?.appointmentId ?? "None" },
          { label: "Assigned staff", value: staffOptions.find(row => row.id === assignedStaffId)?.name ?? (assignedStaffId || "None") },
          { label: "Performance allocation", value: String(formData.get("performanceAttribution") ?? "Existing legacy policy") },
        ]);
        sessionStorage.setItem(walletStorageKey, JSON.stringify(intent));
        setWalletPending(intent); setPaymentOpen(false);
        await sendWalletIntent(intent);
      } catch { setSaleError("Unable to safely preserve the checkout request. Do not collect payment again."); }
      return;
    }
    try {
      regularConfirmation.current ??= { modeAtConfirmation: String(formData.get("modeAtConfirmation") ?? ""), shiftId: String(formData.get("shiftId") ?? "") };
      setRegularPaymentSubmitted(true);
      formData.set("modeAtConfirmation", regularConfirmation.current.modeAtConfirmation);
      formData.set("shiftId", regularConfirmation.current.shiftId);
      result = await action(formData);
    } catch {
      setSaleError("Unable to confirm payment. Your cart and original request ID are retained. Check payment status before retrying.");
      return;
    }

    if (result.status !== "success" || !result.invoice) {
      setSaleError(result.message || "Unable to complete cashier sale.");
      return;
    }

    setCompletedInvoice(result.invoice);
    regularConfirmation.current=null;
    setRegularPaymentSubmitted(false);
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
    setPerformanceTip("0");
    setPaymentReference("");
    setSelectedCustomerPackageIds([]);
    setAvailableCustomerPackages([]);
    setPaymentOpen(false);
    if (!appointmentSale) {
      router.refresh();
    }
  }

  async function sendWalletIntent(intent: WalletCheckoutIntent) {
    if (walletSendLock.current) return;
    walletSendLock.current = true; setWalletSending(true); setSaleError("");
    try {
      const result = await action(toWalletCheckoutFormData(intent));
      if (result.status !== "success" || !result.invoice) {
        setSaleError(`${result.message} Original request retained; do not start another payment.`); return;
      }
      // Remove durable pending state before allowing a new checkout. A storage error keeps recovery locked.
      sessionStorage.removeItem(walletStorageKey);
      sessionStorage.removeItem(operationStorageKey);
      setCompletedInvoice(result.invoice); setWalletPending(null); setWalletRecoveryKey(null); setWalletAmount("");
      setOperationId(`checkout:${crypto.randomUUID()}`);
      if (!appointmentSale) {
        setLines([]); setCustomer(null); setAssignedStaffId("");
        setCustomerPickerKey(key => key + 1);
      }
      setDiscountType("AMOUNT"); setDiscountValue("0"); setDiscountReference("");
      setCatalogDiscountId(""); setLoyaltyPoints("0"); setAdjustmentsOpen(false);
      setCashReceived(""); setPerformanceTip("0"); setPaymentReference("");
      setSelectedCustomerPackageIds([]); setAvailableCustomerPackages([]); setPaymentOpen(false);
      if (!appointmentSale) router.refresh();
    } catch { setSaleError("Payment outcome is unknown. Retry the original request; do not collect payment again."); }
    finally { walletSendLock.current = false; setWalletSending(false); }
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
      {cashierShiftsEnabled && !hasOpenShift && !completedInvoice ? (
        <div className={styles.shiftNotice} role="alert">
          <span>Start a cashier shift before completing a sale.</span>
          <button onClick={() => setShiftModalOpen(true)} type="button">Start shift</button>
        </div>
      ) : null}
      {walletPending || walletRecoveryBlocked ? <section aria-label="Pending wallet checkout" role="status">
        <h3>Restore original wallet checkout</h3>
        {!walletCheckoutEnabled ? <p>Wallet checkout is currently unavailable. The original request remains protected; do not collect payment again.</p> : null}
        <p>Do not collect payment again. This retries the same request and operation key.</p>
        {walletPending ? <><dl>{walletPending.summary.map((row, index) => <div key={index}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
          {saleError.startsWith("CASHIER_SHIFT_MODE_CHANGED") ? <>
            <button type="button" disabled={walletSending} onClick={async()=>{
              setReviewedActivity(null);
              try {
                const result=await cashierActivityOptionsAction(String(toWalletCheckoutFormData(walletPending).get("branchId")??""));
                if(result.ok)setReviewedActivity(result.activity);else setSaleError(`CASHIER_SHIFT_MODE_CHANGED: ${result.message}`);
              }catch{setSaleError("CASHIER_SHIFT_MODE_CHANGED: Current settings could not be loaded. Retry the review.");}
            }}>Review current cashier settings</button>
            {reviewedActivity ? <>
              <p>Cashier shifts: {reviewedActivity.modeAtConfirmation}. Original branch and payment details are retained.</p>
              <button type="button" disabled={walletSending} onClick={async()=>{
                try {
                  const updated=reconfirmWalletCheckoutActivity(walletPending,reviewedActivity);
                  sessionStorage.setItem(walletStorageKey,JSON.stringify(updated));
                  setWalletPending(updated);setReviewedActivity(null);
                  await sendWalletIntent(updated);
                }catch{setSaleError("Could not safely retain the reconfirmed settings. No new payment request was sent.");}
              }}>Confirm settings and retry original checkout</button>
            </> : null}
          </> : null}
          <button type="button" disabled={walletSending} onClick={() => void sendWalletIntent(walletPending)}>{walletSending ? "Checking…" : "Retry original checkout"}</button></>
          : <p>Saved checkout could not be restored safely. Ask the owner to check the original transaction before starting another sale.</p>}
        {saleError ? <p role="alert">{saleError}</p> : null}
      </section> : null}
      {!walletPending && saleError.startsWith("CASHIER_SHIFT_MODE_CHANGED") ? <section role="status">
        <button type="button" onClick={async()=>{
          setReviewedActivity(null);
          try { const result=await cashierActivityOptionsAction(branchId); if(result.ok)setReviewedActivity(result.activity);else setSaleError(`CASHIER_SHIFT_MODE_CHANGED: ${result.message}`); }
          catch { setSaleError("CASHIER_SHIFT_MODE_CHANGED: Could not read current settings. No payment was sent."); }
        }}>Review current cashier settings</button>
        {reviewedActivity ? <><p>Cashier shifts: {reviewedActivity.modeAtConfirmation}. Review and confirm the original payment again.</p>
          <button type="button" onClick={()=>{regularConfirmation.current={modeAtConfirmation:reviewedActivity.modeAtConfirmation,shiftId:reviewedActivity.shiftId??""};setReviewedActivity(null);setSaleError("");}}>Use reviewed cashier settings</button>
        </> : null}
      </section> : null}
      <form action={submitSale} style={walletPending || walletRecoveryBlocked ? { display: "none" } : undefined} className={`${styles.posShell} ${styles.formalShell} ${styles.compactCashier}`}>
      <input name="operationId" type="hidden" value={operationId} />
      <input name="modeAtConfirmation" type="hidden" value={cashierShiftsEnabled ? "ON" : "OFF"} />
      <input name="shiftId" type="hidden" value={cashierShiftsEnabled ? shiftId ?? "" : ""} />
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
            const outOfStock = item.type === "product" && item.stock !== undefined && item.stock < 1;
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
              if (pointsLocked || regularConfirmation.current || walletSendLock.current) return;
              if (nextCustomer?.id !== customer?.id) {
                pointsSequence.current++; pointsCustomerId.current = nextCustomer?.id;
                setLoyaltyPoints("0"); setDraftLoyaltyPoints("0");
                setAppliedPointsContext(null); setPointsRead(null); setPointsReadError(false);
              }
              if (nextCustomer?.id !== customer?.id) { setPaymentWallet(null); setWalletAmount(""); }
              setCustomer(nextCustomer);
              if (!nextCustomer) setLoyaltyPoints("0");
            }}
            posDisplay={false}
            readOnly={Boolean(appointmentSale) || pointsLocked}
            required={requiresCustomer}
          />
          {customer ? <div className={styles.customerFacts}>
            <span>{customer.loyaltyPoints ?? 0} pts · {customer.activePackageCount ?? 0} packages</span>
            <MemberWalletSummary key={customer.id} enabled={walletCheckoutEnabled} customerId={customer.id} customerName={customer.name} entry="cashier" compact />
          </div> : null}
        </div>

        {lines.length > 0 && !appointmentSale ? (
          <label className={`${styles.staffArea} ${!assignedStaffId ? styles.staffRequired : ""}`}>
            <span>
              <strong>{hasServices ? "Service staff" : "Salesperson (optional)"}</strong>
              {hasServices && !assignedStaffId ? <small>Required for service reporting and explicit line commission attribution.</small> : null}
            </span>
            <select
              onChange={(event) => setAssignedStaffId(event.target.value)}
              required={hasServices}
              value={assignedStaffId}
            >
              <option value="">{hasServices ? "Select staff" : "No salesperson"}</option>
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
            const maximumQuantity = line.type === "product" && line.stock !== undefined ? line.stock : 99;
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
          {isTrainingComplimentary ? (
            <div><span>Training / Complimentary</span><strong>−{formatMoney(subtotal)}</strong></div>
          ) : null}
          {taxSettings.enabled ? (
            <div><span>{formatTaxLabel(tax.taxLabel, tax.taxRate)}</span><strong>{formatMoney(tax.tax)}</strong></div>
          ) : null}
          <div className={styles.totalRow}><span>Total</span><strong>{formatMoney(tax.total)}</strong></div>
        </div>

        <input name="walletAmount" type="hidden" value={walletAmount} />
        <input name="method" type="hidden" value={fullWallet ? "MEMBER_WALLET" : paymentMethod} />
        {receivedTip > 0 && <input name="performanceTipAmount" type="hidden" value={performanceTip} />}
        <input name="paymentMethodId" type="hidden" value={fullWallet ? "" : selectedPaymentMethod?.id ?? ""} />
        <input name="paymentMethodCode" type="hidden" value={fullWallet ? "MEMBER_WALLET" : selectedPaymentMethod?.code ?? ""} />
        <input name="checkoutReason" type="hidden" value={isTrainingComplimentary ? checkoutReason : ""} />
        <input name="tenderAmount" type="hidden" value={!fullWallet && isConvertedTender ? tenderAmount : ""} />
        <input name="exchangeRateToMyr" type="hidden" value={!fullWallet && isConvertedTender ? exchangeRateToMyr : ""} />
        <input name="discountType" type="hidden" value={isTrainingComplimentary ? "AMOUNT" : discountType} />
        <input name="discountValue" type="hidden" value={isTrainingComplimentary ? 0 : numericDiscountValue} />
        <input name="discountReference" type="hidden" value={isTrainingComplimentary ? "" : discountReference} />
        <input name="catalogDiscountId" type="hidden" value={isTrainingComplimentary ? "" : catalogDiscountId} />
        <input name="loyaltyPoints" type="hidden" value={isTrainingComplimentary ? 0 : redemption.points} />
        <input name="assignedStaffId" type="hidden" value={assignedStaffId} />
        {!isTrainingComplimentary ? selectedCustomerPackageIds.map((customerPackageId) => (
          <input
            key={customerPackageId}
            name="customerPackageId"
            type="hidden"
            value={customerPackageId}
          />
        )) : null}
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
            : `Pay ${formatMoney(amountDue)}`}
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
                  <span>{isTrainingComplimentary ? "Customer pays" : "Balance to pay"}</span>
                  <strong>{formatMoney(amountDue)}</strong>
                  <small>
                    {isTrainingComplimentary
                      ? `${formatMoney(tax.subtotal)} original service value`
                      : `${totalItems} ${totalItems === 1 ? "item" : "items"}`}
                  </small>
                </section>

                {!isTrainingComplimentary && customer && serviceIdsKey ? (
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
                          const quantity = lines.find(line => line.type === "service" && line.id === option.serviceId)?.quantity ?? 0;
                          const coverageFull = selectedCustomerPackages.filter(item => item.serviceId === option.serviceId).length >= quantity;
                          return (
                            <button
                              aria-pressed={selected}
                              disabled={!selected && coverageFull}
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
                                  const quantity = lines.find(line => line.type === "service" && line.id === option.serviceId)?.quantity ?? 0;
                                  if (current.filter(id => sameServiceIds.has(id)).length >= quantity) return current;
                                  return [...current, option.id];
                                });
                                setCashReceived("");
                              }}
                              type="button"
                            >
                              <span>
                                <strong>{option.name}</strong>
                                <small>{option.serviceName}</small>
                                <small>{customerPackageDateLabels.get(option.id)}</small>
                              </span>
                              <b>{option.remainingUses} / {option.totalUses} Uses Left</b>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p>No purchased package matches these services.</p>
                    )}
                  </section>
                ) : null}

                {!isTrainingComplimentary ? <section className={styles.adjustmentsPanel}>
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
                          : "None"}
                      </small>
                    </span>
                    <b>{totalDiscount > 0 ? "Edit" : "+"}</b>
                  </button>
                </section> : null}

                {walletCheckoutEnabled && walletScope && customer ? <section className={`${styles.paymentSection} ${styles.paymentWallet}`}>
                  <div className={styles.paymentWalletHeading}><h3>Wallet</h3><span aria-live="polite">{walletCents > 0 ? `Using ${formatMoney(walletCents / 100)} · ` : ""}{availableWalletCents !== null ? `${walletCents > 0 ? "of" : "Available"} ${walletMoney((availableWalletCents / 100).toFixed(2)).replace("RM ", "RM")}` : currentPaymentWallet?.error ? "Wallet balance unavailable" : "Loading wallet balance…"}</span></div>
                  <button ref={walletEntryRef} type="button" aria-expanded={walletExpanded} aria-controls="payment-wallet-allocation" disabled={walletPending !== null || walletRecoveryBlocked || (!currentPaymentWallet?.error && availableWalletCents === null)} onClick={() => { if(walletExpanded){closeWalletCard();return;} setWalletDraft(walletCents > 0 ? walletAmount : ""); setWalletDraftError(""); setWalletCardPosition(null); setWalletExpanded(true); }}>{walletCents > 0 ? "Edit" : "Use wallet"}</button>
                  {currentPaymentWallet?.error ? <button type="button" onClick={() => { setPaymentWallet(null); setWalletReadRevision(value => value + 1); }}>Retry wallet balance</button> : null}
                  {walletCents > 0 ? <p>Remaining payment: {formatMoney(externalDue)}</p> : null}
                  {walletExpanded && !walletPending && !walletRecoveryBlocked ? <section ref={walletCardRef} style={walletCardPosition ?? {visibility:"hidden"}} id="payment-wallet-allocation" role="region" aria-label="Wallet allocation" className={styles.walletAllocationCard} onKeyDown={event => {
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeWalletCard(); }
                    if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
                  }}>
                  <h3>Use wallet</h3>
                  <p>{availableWalletCents !== null ? `Available balance ${formatMoney(availableWalletCents / 100)}` : currentPaymentWallet?.error ? "Wallet balance unavailable" : "Loading wallet balance…"}</p>
                  {currentPaymentWallet?.error ? <button type="button" onClick={() => { setPaymentWallet(null); setWalletReadRevision(value => value + 1); }}>Retry wallet balance</button> : null}
                  <div className={styles.paymentWalletInput}>
                    <label>Amount to use<input ref={walletDraftRef} aria-label="Wallet amount (RM)" type="text" inputMode="decimal" placeholder="0.00" value={walletDraft} onFocus={event=>event.currentTarget.select()} onBlur={()=>{if(walletDraft==="")setWalletDraftError("Enter a valid amount.");}} onChange={event => {setWalletDraft(event.target.value);setWalletDraftError("");}} aria-invalid={Boolean(draftError)} /></label>
                    <button type="button" disabled={maxWalletCents === null || maxWalletCents <= 0 || isTrainingComplimentary || (isConvertedTender && maxWalletCents !== totalCents) || !!selectedCustomerPackageIds.length} onClick={() => { if (maxWalletCents !== null) {setWalletDraft((maxWalletCents / 100).toFixed(2));setWalletDraftError("");} }}>{maxWalletCents === null ? "Use max" : `Use max ${formatMoney(maxWalletCents / 100)}`}</button>
                  </div>
                  <p>Remaining payment: {formatMoney(draftRemainingCents/100)}</p>
                  {draftError ? <p role="alert">{draftError}</p> : null}
                  <div className={styles.walletAllocationActions}><button type="button" onClick={closeWalletCard}>Cancel</button><button type="button" disabled={!draftValid || Boolean(walletPending) || walletRecoveryBlocked} onClick={applyWalletDraft}>Apply wallet</button></div>
                  </section> : null}
                  {walletCents > 0 && availableWalletCents === null ? <p role="alert">Wallet balance must be available before using wallet funds. Clear the wallet amount to pay another way.</p> : availableWalletCents !== null && walletCents > availableWalletCents ? <p role="alert">Wallet amount exceeds available wallet balance.</p> : null}
                  {!walletReady ? <p role="alert">Wallet requires a MYR sale without package redemption or Training / Complimentary.</p> : null}
                </section> : null}
                {!fullWallet ? <section className={styles.paymentSection}>
                  <h3>Payment method</h3>
                  <div aria-label="Payment method" className={styles.paymentChoices}>
                    {paymentMethods.filter(method => !walletCents || (method.paymentKind === "LOCAL_TENDER" && method.settlementCurrency === "MYR" && method.behavior === "STANDARD_TENDER")).map((method) => (
                      <button
                        className={paymentMethodCode === method.code ? styles.activePaymentChoice : ""}
                        key={method.code}
                        onClick={() => {
                          setPaymentMethodCode(method.code);
                          if (method.behavior === "TRAINING_COMPLIMENTARY") {
                            setSelectedCustomerPackageIds([]);
                            setCashReceived("");
                            setPaymentReference("");
                          }
                          setTenderAmount("");
                          setExchangeRateToMyr("");
                          setSaleError("");
                        }}
                        type="button"
                      >
                        {method.label}
                      </button>
                    ))}
                  </div>
                </section> : null}

                {fullWallet ? <p>Paid entirely from the member wallet.</p> : isTrainingComplimentary ? (
                  <section className={styles.paymentSection}>
                    <h3>Training / Complimentary details</h3>
                    <p>Customer pays RM0.00. No cash or payment record is created. Staff commission uses the original service price.</p>
                    <label className={`${styles.referenceField} ${styles.paymentReferenceField}`}>
                      <span>Reason</span>
                      <textarea
                        maxLength={500}
                        onChange={(event) => setCheckoutReason(event.target.value)}
                        placeholder="e.g. New therapist supervised training session"
                        rows={3}
                        value={checkoutReason}
                      />
                    </label>
                  </section>
                ) : paymentMethod === "CASH" ? (
                  <section className={`${styles.paymentSection} ${styles.paymentCashCompact}`}>
                    <h3>Cash received</h3>
                    <div className={styles.cashSuggestions}>
                      {cashSuggestions.map((amount, index) => (
                        <button
                          className={cashReceived === amount ? styles.activeCashSuggestion : ""}
                          key={amount}
                          onClick={() => { setCashReceived(amount); setCustomCashExpanded(false); }}
                          type="button"
                        >
                          {index === 0 ? "Exact " : ""}{formatMoney(Number(amount))}
                        </button>
                      ))}
                      <button aria-expanded={customCashExpanded} onClick={() => { setCustomCashExpanded(true); cashReceivedRef.current?.click(); }} type="button">Custom</button>
                    </div>
                    <div className={styles.paymentCashReceived}><span>Received</span><strong>{formatMoney(Number(cashReceived) || 0)}</strong></div>
                    <div className={styles.cashChange}><span>Change</span><strong>{formatMoney(cashChange)}</strong></div>
                    <div className={styles.paymentCashCustom} hidden={!customCashExpanded}>
                    <div className={styles.cashTender}>
                      <label>
                        <span>Amount received</span>
                        <MoneyNumpadInput
                          aria-invalid={!cashPaymentReady}
                          amountDue={externalDue}
                          onValueChange={setCashReceived}
                          placeholder={formatMoney(externalDue)}
                          ref={cashReceivedRef}
                          value={cashReceived}
                        />
                      </label>
                    </div>
                    </div>
                  </section>
                ) : isConvertedTender ? (
                  <section className={styles.paymentSection}>
                    <h3>{selectedPaymentMethod?.paymentKind === "CRYPTO_ASSET" ? "Crypto received" : "Foreign currency received"}</h3>
                    <p>The invoice stays in MYR. Record the actual {tenderSymbol} received and the rate used for this payment.</p>
                    <div className={styles.convertedTenderGrid}>
                      <label>
                        <span>Amount received ({tenderSymbol})</span>
                        <input inputMode="decimal" min="0.00000001" onChange={(event) => setTenderAmount(event.target.value)} placeholder="0.00" step="0.00000001" type="number" value={tenderAmount} />
                      </label>
                      <label>
                        <span>MYR rate for 1 {tenderSymbol}</span>
                        <input inputMode="decimal" min="0.00000001" onChange={(event) => setExchangeRateToMyr(event.target.value)} placeholder="0.00" step="0.00000001" type="number" value={exchangeRateToMyr} />
                      </label>
                      <div className={styles.convertedTenderSummary}>
                        <span>MYR equivalent</span>
                        <strong>{formatMoney(tenderEquivalent)}</strong>
                        <small>Balance due {formatMoney(amountDue)}</small>
                      </div>
                    </div>
                    <label className={`${styles.referenceField} ${styles.paymentReferenceField}`}>
                      <span>{selectedPaymentMethod?.paymentKind === "CRYPTO_ASSET" ? "Transaction hash / reference" : "Exchange / receipt reference"}</span>
                      <input maxLength={120} name="reference" onChange={(event) => setPaymentReference(event.target.value)} placeholder="Enter transaction reference" required value={paymentReference} />
                    </label>
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
                  {isTrainingComplimentary ? <div><span>Training / Complimentary</span><strong>−{formatMoney(subtotal)}</strong></div> : null}
                  {taxSettings.enabled ? <div><span>{formatTaxLabel(tax.taxLabel, tax.taxRate)}</span><strong>{formatMoney(tax.tax)}</strong></div> : null}
                  {selectedPackageApplications.map((option) => (
                    <div className={styles.packageCoverageRow} key={option.id}>
                      <span>{option.serviceName} · Package voucher</span>
                      <strong>−{formatMoney(option.coveredAmount)}</strong>
                    </div>
                  ))}
                  {receivedTip > 0 && <div><span>Tip (not a payout)</span><strong>{formatMoney(receivedTip)}</strong></div>}
                  <div><span>Total</span><strong>{formatMoney(tax.total)}</strong></div>
                  {packageCoverage > 0 ? (
                    <div className={styles.amountDueRow}><span>Amount due</span><strong>{formatMoney(amountDue)}</strong></div>
                  ) : null}
                </div>
                {performanceAvailable && !isTrainingComplimentary && <label className={styles.referenceField} style={{ padding: "12px" }}>
                  <span>Tip amount · 小费（不是发放）</span>
                  <input type="number" min="0" max="9999999" step="0.01" inputMode="decimal" value={performanceTip} onChange={(event) => setPerformanceTip(event.target.value)} />
                </label>}
                <CheckoutAttribution branchId={branchId} appointmentId={appointmentSale?.appointmentId} hasTip={receivedTip > 0} onEnabledChange={setPerformanceAvailable} exempt={isTrainingComplimentary || amountDue <= 0 || !lines.length} />
              </aside>
            </div>

            {saleError ? <p className={styles.paymentError}>{saleError}</p> : null}
            <footer className={styles.paymentFooter}>
              <button onClick={() => setPaymentOpen(false)} type="button">Back</button>
              <CashierPayButton
                canPay={canPay && walletReady && cashPaymentReady && convertedTenderReady && paymentReferenceReady && trainingCheckoutReady}
                cashRequired={paymentMethod === "CASH" && !cashPaymentReady}
                complimentary={isTrainingComplimentary}
                referenceRequired={!paymentReferenceReady}
                total={amountDue}
              />
            </footer>
          </section>
        </div>
      ) : null}
      </form>
    {cashierShiftsEnabled && shiftModalOpen && typeof document !== "undefined"
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
                  <PosOutletBranchField singleOutlet={singleOutlet} branches={branches} branchId={branchId} />
                  <label>
                    <span>Opening cash float</span>
                    <input
                      defaultValue="0.00"
                      inputMode="decimal"
                      min="0"
                      name="openingFloat"
                      onFocus={(event) => event.currentTarget.select()}
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
                  onClick={() => {
                    if (adjustmentTab !== "POINTS") { pointsRefreshRequested.current = true; setPointsRead(null); setPointsReadError(false); }
                    setAdjustmentTab("POINTS");
                  }}
                  role="tab"
                  type="button"
                >
                  Points
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
                    {!draftCatalogDiscountId ? <><div aria-label="Discount type" className={styles.adjustmentMode}>
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

                    </> : null}
                    <label className={styles.adjustmentField}>
                      <span>Reference (optional)</span>
                      <input
                        maxLength={160}
                        onChange={(event) => setDraftDiscountReference(event.target.value)}
                        placeholder="Promotion code or note"
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
                            ? customer.phone
                            : "A customer account is required to redeem points."}
                        </small>
                      </div>
                      <b>{freshPoints?.membershipStatus === "ACTIVE" ? "Points" : customer ? "" : "Required"}</b>
                    </button>

                    <div className={styles.pointsBalance}>
                      <span>Available<strong>{freshPoints ? `${freshPoints.availablePoints.toLocaleString("en-MY")} pts` : "—"}</strong></span>
                      {freshPoints && freshPoints.settings.pointsPerRinggit > 0 ? <span>{freshPoints.settings.pointsPerRinggit.toLocaleString("en-MY")} points = RM1</span> : null}
                    </div>
                    {pointsUnavailableReason ? <p role="status" className={styles.pointsHint}>{pointsUnavailableReason}{pointsReadError ? <> <button type="button" onClick={() => setPointsReadRevision(value => value + 1)}>Retry</button></> : null}</p> : null}
                    {freshPoints && Number(loyaltyPoints) > 0 && (!pointsEligible || maximumPoints < Number(loyaltyPoints) || (appliedPoints && appliedPoints.settings.pointsPerRinggit !== freshPoints.settings.pointsPerRinggit)) ? <p className={styles.pointsHint}>Points availability has changed. Review and apply again.</p> : null}

                    <div className={styles.pointsInputRow}>
                      <label className={styles.adjustmentField}>
                        <span>Points to redeem</span>
                        <MoneyNumpadInput
                          aria-label="Points to redeem"
                          amountDue={maximumPoints}
                          amountLabel="Maximum"
                          decimalPlaces={0}
                          dialogEyebrow="LOYALTY REWARD"
                          dialogTitle="Points to redeem"
                          disabled={pointsControlsDisabled}
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
                        disabled={pointsControlsDisabled}
                        onClick={useMaximumPoints}
                        type="button"
                      >
                        Use max
                      </button>
                    </div>

                    <div className={styles.pointsPreview}>
                      <span>Discount<strong>{formatMoney(pointsEligible ? draftLoyaltyDiscount : 0)}</strong></span>
                      <span>Remaining points<strong>{freshPoints ? `${(freshPoints.availablePoints - (pointsEligible ? draftRedemption.points : 0)).toLocaleString("en-MY")} pts` : "—"}</strong></span>
                    </div>
                    {freshPoints ? <p className={styles.pointsHint}>Minimum redemption: {freshPoints.settings.minimumPoints.toLocaleString("en-MY")} points</p> : null}
                    {pointsEligible && freshPoints && maximumPoints > 0 && maximumPoints < freshPoints.availablePoints ? <p className={styles.pointsHint}>Up to {maximumPoints.toLocaleString("en-MY")} points can be used for this order.</p> : null}

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
                      <span>Points ({draftRedemption.points} pts)</span>
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
                {catalogDiscountId || numericDiscountValue > 0 ? (
                  <button className={styles.removeDiscountButton} disabled={discountRemovalLocked || !!regularConfirmation.current} onClick={removeDiscount} type="button">Remove discount</button>
                ) : <button onClick={() => setAdjustmentsOpen(false)} type="button">Cancel</button>}
                <button
                  disabled={pointsLocked || Boolean(draftDiscountReferenceError || draftRedemption.error) || ((adjustmentTab === "POINTS" || (draftUsesFreshPoints && Number(draftLoyaltyPoints) > 0)) && pointsControlsDisabled)}
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
  complimentary,
  referenceRequired,
  total,
}: {
  canPay: boolean;
  cashRequired: boolean;
  complimentary: boolean;
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
            : complimentary
              ? "Confirm complimentary service · RM0.00"
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
