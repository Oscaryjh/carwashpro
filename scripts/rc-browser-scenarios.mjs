import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";

// Secrets, authoritative IDs and response bodies remain process-local.
export async function runScenario(name, kit) {
  const { login: loginRaw, getPage, base, prisma, report } = kit;
  const login = async role => { if (getPage()) await getPage().goto(base + "/team"); await loginRaw(role); };
  const ensureSalonShift = async () => {
    const page = getPage();
    const previous = page.url();
    await page.goto(base + "/cashier");
    const close = page.getByRole("button", { name: "Close customer picker", exact: true });
    if (await close.isVisible()) await close.click();
    const start = page.getByRole("button", { name: "Start shift", exact: true });
    if (await start.count()) {
      await start.click();
      const dialog = page.getByRole("dialog", { name: "Start shift", exact: true });
      await dialog.locator('select[name="branchId"]').selectOption({ label: "Branch A" });
      await dialog.locator('input[name="openingFloat"]').fill("100.00");
      await dialog.getByRole("button", { name: "Start shift", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    await page.goto(previous);
  };
  getPage()?.setDefaultTimeout(10000);
  if (name === "disabled-probe") {
    const page = getPage();
    report({ stage: "DISABLED_PAGE_STATE", path: new URL(page.url()).pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, ":id"),
      disabledLabel: await page.getByText(/Not enabled/).count(), appError: await page.getByText(/Application error:|Internal Server Error/).count() });
    const result = await page.evaluate(async () => { const r = await fetch('/team/payroll/statutory'); const text = await r.text(); return { status: r.status, path: new URL(r.url).pathname,
      disabledLabel: text.includes('Not enabled'), moduleDenied: text.includes('Module not enabled'), failedFlight: text.includes('Application error') }; });
    report({ stage: "DISABLED_HTTP_STATE", ...result });
  } else if (name === "inspect-error") {
    const page = getPage();
    const errors = await page.locator('.error,[role="alert"],.form-message,[class*="paymentError"]').allTextContents();
    report({ stage: "HTML_VALIDATION", invalid: await page.locator('input:invalid,select:invalid').evaluateAll(nodes => nodes.map(n => ({ tag: n.tagName, type: n.type, name: n.name, label: n.getAttribute("aria-label"), required: n.required, valueMissing: n.validity.valueMissing, typeMismatch: n.validity.typeMismatch, patternMismatch: n.validity.patternMismatch, rangeOverflow: n.validity.rangeOverflow, rangeUnderflow: n.validity.rangeUnderflow, stepMismatch: n.validity.stepMismatch, message: n.validationMessage }))) });
    report({ stage: "REFUND_DIAGNOSTIC", refundCount: await prisma.paymentRefund.count(), creditNoteCount: await prisma.creditNote.count() });
    report({ stage: "CLIENT_RUNTIME", state: await page.evaluate(() => ({ ready: document.readyState, scripts: document.scripts.length, loadedScripts: performance.getEntriesByType("resource").filter(r => r.initiatorType === "script").length, reactHandlers: [...document.querySelectorAll('input[name="contactType"]')].map(n => Object.keys(n).some(k => k.startsWith("__reactProps$"))), checked: document.querySelector('input[name="contactType"]:checked') !== null, selectedServices: document.querySelectorAll('input[name="serviceIds"]').length })) });
    report({ stage: "FORM_STATE", path: new URL(page.url()).pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g, ":id"), invalidFields: await page.locator(":invalid").evaluateAll(nodes => nodes.map(n => n.getAttribute("name"))), workOrderCount: await prisma.workOrder.count({ where: { business: { slug: "tetamu-uat-auto" } } }) });
    report({ stage: "FORM_ERROR", errors: errors.map(text => text.replace(/(?:https?:\/\/|postgres(?:ql)?:\/\/)[^\s]+/g, "[redacted]").replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "[redacted]").replace(/\+?\d[\d -]{6,}\d/g, "[redacted]").slice(0, 160)) });
  } else if (name === "auto-start") {
    await login("AUTO"); const page = getPage();
    const vehicle = await prisma.vehicle.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-auto" } } });
    await page.goto(base + "/work-orders/new");
    await page.locator('input[name="plate"]').fill(vehicle.plateNumber);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.waitForFunction(() => {
      const input = document.querySelector('input[name="contactType"]');
      const key = input && Object.keys(input).find(name => name.startsWith("__reactProps$"));
      return key && typeof input[key]?.onChange === "function";
    });
    await page.getByRole("button", { name: /Premium Detailing/ }).click();
    await page.locator('label').filter({ has: page.locator('input[name="contactType"][value="REGISTERED_OWNER"]') }).click();
    const branch = page.locator('select[name="branchId"]');
    if (await branch.count()) await branch.selectOption(vehicle.branchId);
    await page.getByRole("button", { name: "Create job", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/work-orders");
    const created = await prisma.workOrder.findFirstOrThrow({ where: { businessId: vehicle.businessId, vehicleId: vehicle.id }, orderBy: { createdAt: "desc" } });
    await page.locator(`a[href="/work-orders/${created.id}"]`).first().click();
    const link = page.getByRole("link", { name: "Go to POS", exact: true });
    await link.click();
    await page.waitForURL(url => url.pathname.startsWith("/pos/"));
    report({ stage: "AUTO_JOB_TO_POS", status: "PASS" });
  } else if (name === "auto-pay") {
    const page = getPage(); const posPath = new URL(page.url()).pathname;
    assert.ok(posPath.startsWith("/pos/"), "AUTO_POS_REQUIRED");
    const workOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id: posPath.split("/").at(-1) } });
    await page.goto(base + "/closing");
    if (await page.locator('input[name="openingFloat"]').count()) {
      await page.locator('select[name="branchId"]').first().selectOption(workOrder.branchId);
      await page.locator('input[name="openingFloat"]').fill("100.00");
      await page.getByRole("button", { name: "Start shift", exact: true }).click();
    }
    await page.getByRole("heading", { name: "Current shift", exact: true }).waitFor();
    await page.goto(base + posPath);
    await page.locator('input[name="amount"]').fill("180.00");
    const requestPromise = page.waitForRequest(r => r.method() === "POST" && new URL(r.url()).origin === base);
    await page.getByRole("button", { name: "Check out", exact: true }).click();
    const paidRequest = await requestPromise;
    await page.waitForURL(url => url.pathname === "/work-orders");
    const paid = await prisma.workOrder.findUniqueOrThrow({ where: { id: workOrder.id }, include: { payments: true, invoice: true } });
    assert.equal(paid.paymentStatus, "PAID", "POS_PAYMENT_NOT_PAID");
    assert.equal(paid.paidAmount.toString(), "180", "POS_PAYMENT_AMOUNT_MISMATCH");
    const replay = await page.evaluate(async ({ url, headers, body }) => {
      const response = await fetch(url, { method: "POST", headers, credentials: "include", body: Uint8Array.from(atob(body), c => c.charCodeAt(0)) });
      return { status: response.status, login: new URL(response.url).pathname === "/login" };
    }, { url: paidRequest.url(), headers: Object.fromEntries(Object.entries(paidRequest.headers()).filter(([key]) => ["content-type", "next-action", "next-router-state-tree"].includes(key))), body: paidRequest.postDataBuffer().toString("base64") });
    assert.ok(replay.status < 500 && !replay.login, "POS_REPLAY_SERVER_ERROR");
    assert.equal(await prisma.payment.count({ where: { workOrderId: workOrder.id } }), paid.payments.length, "POS_DUPLICATE_PAYMENT");
    await page.goto(base + `/work-orders/${workOrder.id}`);
    await page.getByRole("link", { name: /^View invoice/ }).first().click();
    const receipt = page.locator('a[href$="/pdf?format=receipt"]').first();
    const receiptResponse = await page.evaluate(async href => { const r = await fetch(href); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, pdf: String.fromCharCode(...b.slice(0,4)) === "%PDF" }; }, await receipt.getAttribute("href"));
    assert.equal(receiptResponse.status, 200, "POS_RECEIPT_HTTP_FAILURE");
    assert.equal(receiptResponse.pdf, true, "POS_RECEIPT_INVALID");
    report({ stage: "AUTO_PAYMENT_INVOICE_RECEIPT_REPLAY", status: "PASS", duplicatePayment: false });
  } else if (name === "auto-refund-close") {
    const page = getPage();
    const invoiceId = new URL(page.url()).pathname.split("/").at(-1);
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    await page.locator('form').filter({ has: page.getByRole("button", { name: "Process refund", exact: true }) }).locator('input[name="amount"]').fill("20.00");
    await page.locator('textarea[name="reason"]').fill("Disposable RC synthetic refund verification");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Process refund", exact: true }).click();
    await page.getByText(/^Refund recorded\./).waitFor();
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    assert.equal(after.total.toString(), invoice.total.toString(), "REFUND_CHANGED_INVOICE_TOTAL");
    const shift = await prisma.cashierShift.findFirstOrThrow({ where: { businessId: invoice.businessId, status: "OPEN" } });
    const paid = await prisma.payment.aggregate({ where: { shiftId: shift.id, method: "CASH", status: "ACTIVE" }, _sum: { amount: true } });
    const refunded = await prisma.paymentRefund.aggregate({ where: { shiftId: shift.id, method: "CASH" }, _sum: { amount: true } });
    const expectedCash = Number(shift.openingFloat) + Number(paid._sum.amount) - Number(refunded._sum.amount);
    await page.goto(base + "/closing");
    await page.locator('input[name="closingCash"]').fill(expectedCash.toFixed(2));
    await page.getByRole("button", { name: "End shift", exact: true }).click();
    await page.getByRole("heading", { name: "Start shift", exact: true }).waitFor();
    const closed = await prisma.cashierShift.findUniqueOrThrow({ where: { id: shift.id } });
    assert.equal(closed.status, "CLOSED", "SHIFT_NOT_CLOSED");
    assert.equal(Number(closed.cashDifference), 0, "SHIFT_CASH_DIFFERENCE");
    report({ stage: "AUTO_REFUND_SHIFT_CLOSE_RECONCILIATION", status: "PASS" });
  } else if (name === "auto-daily") {
    const page = getPage();
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "View", exact: true }) });
    await form.locator('select[name="branchId"]').selectOption({ label: "Branch A" });
    await form.getByRole("button", { name: "View", exact: true }).click();
    report({ stage: "AUTO_DAILY_CLOSING_LOADED", status: "PASS" });
  } else if (name === "receipt") {
    const page = getPage();
    const href = await page.locator('a[href$="/pdf?format=receipt"]').first().getAttribute("href");
    const result = await page.evaluate(async target => { const r = await fetch(target); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, pdf: String.fromCharCode(...b.slice(0,4)) === "%PDF" }; }, href);
    report({ stage: "RECEIPT_HTTP", ...result });
  } else if (name === "salon-start") {
    await login("SALON"); const page = getPage();
    await page.goto(base + "/cashier");
    assert.ok(await page.getByRole("heading", { name: /Cashier/ }).count() > 0, "SALON_CASHIER_NOT_LOADED");
    report({ stage: "SALON_CASHIER", status: "PASS", loaded: true });
  } else if (name === "salon-pay") {
    const page = getPage();
    const closePicker = page.getByRole("button", { name: "Close customer picker", exact: true });
    if (await closePicker.isVisible()) await closePicker.click();
    const business = await prisma.business.findUniqueOrThrow({ where: { slug: "tetamu-uat-salon" } });
    const before = await prisma.payment.count({ where: { businessId: business.id } });
    if (await page.getByRole("button", { name: "Start shift", exact: true }).count()) {
      await page.getByRole("button", { name: "Start shift", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start shift", exact: true });
      await dialog.locator('select[name="branchId"]').selectOption({ label: "Branch A" });
      await dialog.locator('input[name="openingFloat"]').fill("100.00");
      await dialog.getByRole("button", { name: "Start shift", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
    }
    const clear = page.getByRole("button", { name: "Clear", exact: true });
    if (await clear.count()) await clear.click();
    await page.getByRole("button", { name: /^Haircut\b/ }).click();
    await page.getByRole("button", { name: /Select customer.*Choose/ }).click();
    await page.getByPlaceholder("Phone or customer name", { exact: true }).fill("UAT Customer A");
    await page.getByRole("button", { name: /UAT Customer A/ }).click();
    await page.getByLabel(/Service & sales staff/).selectOption({ label: "UAT Stylist A" });
    await page.getByRole("button", { name: /^Payment ·/ }).click();
    await page.getByRole("button", { name: /^Exact RM50/ }).click();
    await page.getByRole("button", { name: /^Confirm payment ·/ }).click();
    await page.getByRole("heading", { name: /Payment complete|Receipt|Invoice/ }).first().waitFor();
    assert.equal(await prisma.payment.count({ where: { businessId: business.id } }), before + 1, "SALON_PAYMENT_COUNT");
    const payment = await prisma.payment.findFirstOrThrow({ where: { businessId: business.id }, orderBy: { createdAt: "desc" } });
    assert.equal(payment.amount.toString(), "50", "SALON_PAYMENT_AMOUNT");
    report({ stage: "SALON_CUSTOMER_PAYMENT", status: "PASS" });
  } else if (name === "salon-finish") {
    const page = getPage();
    report({ stage: "SALON_PAYMENT_STATE", enabled: await page.getByRole("button", { name: /^Confirm payment ·/ }).isEnabled(), inputsPresent: await page.locator('input[name="assignedStaffId"],input[name="customerId"],input[name="branchId"]').evaluateAll(nodes => nodes.map(n => ({ name: n.name, present: Boolean(n.value) }))) });
    await page.getByRole("button", { name: /^Confirm payment ·/ }).click();
    await page.getByRole("heading", { name: "Invoice", exact: true }).waitFor();
    report({ stage: "SALON_CUSTOMER_PAYMENT", status: "PASS" });
  } else if (["salon-appointment", "package-appointment", "appointment-create-manage"].includes(name)) {
    if (name !== "package-appointment") await login("SALON");
    const page = getPage();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuching" }).format(new Date(Date.now() + 86400000));
    await page.goto(`${base}/appointments/new?date=${day}&time=${name === "package-appointment" ? "11:00" : name === "appointment-create-manage" ? "13:00" : "10:00"}`);
    await page.getByRole("button", { name: "Search customer", exact: true }).click();
    await page.getByPlaceholder("Search name or phone", { exact: true }).fill("UAT Customer A");
    await page.getByRole("button", { name: /UAT Customer A/ }).click();
    await page.locator('select[name="branchId"]').selectOption({ label: "Branch A" });
    await page.locator('select[name="serviceId"]').selectOption({ label: "Haircut - RM50.00" });
    await page.locator('select[name="assignedStaffId"]').selectOption({ label: "UAT Stylist A" });
    await page.getByRole("button", { name: "Create appointment", exact: true }).click();
    await page.waitForURL(url => !url.pathname.endsWith("/new"));
    report({ stage: "SALON_APPOINTMENT_CREATED", status: "PASS" });
  } else if (name === "appointment-conflict") {
    await runScenario("appointment-create-manage", kit);
    const page = getPage();
    const target = await prisma.appointment.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" } }, orderBy: { createdAt: "desc" } });
    const before = await prisma.appointment.count({ where: { businessId: target.businessId } });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuching" }).format(target.scheduledAt);
    await page.goto(`${base}/appointments/new?date=${day}&time=13:00`);
    await page.getByRole("button", { name: "Search customer", exact: true }).click();
    await page.getByPlaceholder("Search name or phone", { exact: true }).fill("UAT Customer A");
    await page.getByRole("button", { name: /UAT Customer A/ }).click();
    await page.locator('select[name="branchId"]').selectOption({ label: "Branch A" });
    await page.locator('select[name="serviceId"]').selectOption({ label: "Haircut - RM50.00" });
    await page.locator('select[name="assignedStaffId"]').selectOption({ label: "UAT Stylist A" });
    await page.getByRole("button", { name: "Create appointment", exact: true }).click();
    await page.getByText(/This staff member already has .* booked from/).waitFor();
    assert.equal(await prisma.appointment.count({ where: { businessId: target.businessId } }), before, "APPOINTMENT_CONFLICT_CREATED_DUPLICATE");
    report({ stage: "APPOINTMENT_CONFLICT_REJECTED", status: "PASS" });
  } else if (name === "appointment-edit-cancel") {
    const page = getPage();
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" } }, orderBy: { createdAt: "desc" } });
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuching" }).format(appointment.scheduledAt);
    assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kuching", hour: "2-digit", minute: "2-digit" }).format(appointment.scheduledAt), "13:00", "APPOINTMENT_TIMEZONE_FAILURE");
    await page.goto(`${base}/appointments?date=${day}&appointment=${appointment.id}`);
    await page.locator(".appointment-detail-staff").click();
    const editor = page.locator(".appointment-edit-modal");
    await editor.getByRole("button", { name: /^2:00\s?pm$/i }).click();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await editor.waitFor({ state: "hidden" });
    const updated = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    assert.equal(updated.scheduledAt.getTime() - appointment.scheduledAt.getTime(), 3600000, "APPOINTMENT_EDIT_TIME_FAILURE");
    await page.getByRole("button", { name: "Appointment quick actions", exact: true }).click();
    await page.getByRole("button", { name: /Cancel Appointment/i }).click();
    await page.locator(".appointment-quick-action-confirmation").getByRole("button", { name: "Cancel appointment", exact: true }).click();
    await page.locator(".appointment-quick-action-confirmation").waitFor({ state: "hidden" });
    assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status, "CANCELLED");
    report({ stage: "APPOINTMENT_TIMEZONE_EDIT_CANCEL", status: "PASS" });
  } else if (name === "salon-appointment-checkout") {
    const page = getPage();
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" } }, orderBy: { createdAt: "desc" } });
    await page.goto(`${base}/appointments/${appointment.id}`);
    await page.getByRole("button", { name: /^Complete service$/i }).click();
    await page.waitForLoadState("networkidle");
    report({ stage: "SALON_SERVICE_COMPLETED", status: (await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status === "COMPLETED" ? "PASS" : "FAIL" });
  } else if (name === "salon-finalized-pay") {
    const page = getPage();
    await ensureSalonShift();
    await page.getByRole("link", { name: "Payment & Invoice", exact: true }).click();
    await page.getByRole("button", { name: /^Payment ·/ }).click();
    await page.getByRole("button", { name: /^Exact RM50/ }).click();
    await page.getByRole("button", { name: /^Confirm payment ·/ }).click();
    await page.getByRole("heading", { name: "Invoice", exact: true }).waitFor();
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" } }, orderBy: { createdAt: "desc" }, include: { invoice: true, payments: true } });
    assert.equal(appointment.invoice.status, "PAID", "SALON_INVOICE_UNPAID");
    assert.equal(appointment.invoice.total.toString(), "50", "SALON_INVOICE_AMOUNT");
    assert.equal(appointment.payments.length, 1, "SALON_DUPLICATE_PAYMENT");
    report({ stage: "SALON_APPOINTMENT_TO_PAYMENT_INVOICE", status: "PASS" });
  } else if (name === "daily-audit") {
    await login("AUTO"); const page = getPage();
    const response = await page.goto(base + "/closing");
    const business = await prisma.business.findUniqueOrThrow({ where: { slug: "tetamu-uat-auto" }, include: { users: true } });
    const html = await response.text();
    assert.equal(await prisma.dailyClosingSnapshot.count({ where: { businessId: business.id } }), 1, "DAILY_SNAPSHOT_MISSING");
    assert.equal((await page.locator("body").innerText()).includes("Closed"), true, "DAILY_FROZEN_STATE_MISSING");
    report({ stage: "AUTO_DAILY_CLOSING_FROZEN", status: "PASS" });
    report({ stage: "DAILY_CLOSING_DIAGNOSTIC", industry: business.industryType, ownerRole: business.users.find(u => u.email === "uat.auto.owner@tetamu.test")?.role, completePanelInResponse: html.includes("Complete daily closing"), headings: await page.locator("h1,h2").allTextContents() });
  } else if (name === "staff") {
    const browser = kit.getContext().browser();
    await getPage().goto(base + "/team"); await kit.logout();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, httpCredentials: { username: kit.runtime.UAT_PREVIEW_ACCESS_USERNAME, password: kit.runtime.UAT_PREVIEW_ACCESS_PASSWORD } });
    await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const member = await prisma.employeeBusinessMembership.findUniqueOrThrow({ where: { id: kit.personas.find(p => p.persona === "STAFF").membershipId } });
    let authenticated = false;
    try {
      await page.goto(base + "/staff/login");
      await page.getByPlaceholder("012 345 6789").fill(member.phoneNumber);
      await page.getByRole("button", { name: /Request verification code/ }).click();
      await page.getByLabel("Digit 1", { exact: true }).waitFor();
      const challenge = await prisma.employeeOtpChallenge.findFirstOrThrow({ where: { phoneNumberNormalized: member.phoneNumberNormalized, invalidatedAt: null, verifiedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
      const digest = createHmac("sha256", kit.runtime.UAT_PREVIEW_OTP_HMAC_SEED).update("tetamu:uat-preview-otp:v1\0").update(challenge.id).update("\0").update(member.phoneNumberNormalized).update("\0").update(String(Math.floor(challenge.expiresAt.getTime() / 1000))).digest();
      const code = (digest.readUInt32BE(0) % 1000000).toString().padStart(6, "0");
      for (let i = 0; i < 6; i++) await page.getByLabel(`Digit ${i + 1}`, { exact: true }).fill(code[i]);
      await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
      await page.waitForURL(url => !["/staff/login", "/staff/verify"].includes(url.pathname));
      authenticated = true;
      assert.ok((await prisma.employeeOtpChallenge.findUniqueOrThrow({ where: { id: challenge.id } })).verifiedAt, "OTP_NOT_CONSUMED");
      report({ stage: "STAFF_SIX_DIGIT_OTP", status: "PASS" });
      for (const mobile of [true, false]) {
        await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
        for (const path of ["/staff", "/staff/history", "/staff/roster", "/staff/timesheet", "/staff/leave", "/staff/claims", "/staff/payslips", "/staff/profile"]) {
          const response = await page.goto(base + path);
          assert.equal(response.status(), 200, "STAFF_PAGE_HTTP_FAILURE");
          assert.equal(new URL(page.url()).pathname, path, "STAFF_PAGE_REDIRECT");
          assert.equal(await page.getByText(/Application error:|Internal Server Error/).count(), 0);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
          report({ stage: "STAFF_PAGE", route: path, mobile, status: overflow ? "NEEDS_IMPROVEMENT" : "PASS", overflow });
        }
      }
      const own = await prisma.payrollPayslipPublication.findFirstOrThrow({ where: { membershipId: member.id } });
      const other = await prisma.payrollPayslipPublication.findFirstOrThrow({ where: { businessId: member.businessId, membershipId: { not: member.id } } });
      for (const [publication, expected] of [[own, 200], [other, 404]]) {
        const proof = await page.evaluate(async path => { const r = await fetch(path); const b = new Uint8Array(await r.arrayBuffer()); return { status: r.status, cache: r.headers.get("cache-control"), pdf: String.fromCharCode(...b.slice(0,4)) === "%PDF" }; }, `/staff/payslips/${publication.id}`);
        assert.equal(proof.status, expected, "STAFF_PAYSLIP_SCOPE_FAILURE");
        assert.equal(proof.pdf, expected === 200, "STAFF_PAYSLIP_CONTENT_FAILURE");
        if (expected === 200) assert.match(proof.cache, /no-store/);
        report({ stage: expected === 200 ? "STAFF_OWN_PAYSLIP" : "STAFF_OTHER_PAYSLIP_DENIED", status: "PASS" });
      }
    } finally {
      try { if (authenticated) {
        report({ stage: "STAFF_LOGOUT_PROFILE_START" });
        await page.goto(base + "/staff/profile");
        report({ stage: "STAFF_LOGOUT_PROFILE_READY" });
        await page.getByRole("button", { name: "Sign out of Staff App", exact: true }).click();
        report({ stage: "STAFF_LOGOUT_CLICKED" });
        await page.waitForURL(url => url.pathname === "/staff/login");
        report({ stage: "STAFF_LOGOUT_LOGIN_URL" });
        await page.getByRole("button", { name: /Request verification code/ }).waitFor();
        report({ stage: "STAFF_LOGOUT_LOGIN_READY" });
        assert.ok(!(await page.locator("body").innerText()).includes(member.fullName), "STAFF_LOGOUT_DATA_LEAK");
        // Next streams an HTTP 200 redirect. Its meta-refresh and hydrated
        // redirect can supersede one another, so assert the stable destination
        // instead of awaiting the first transient navigation's load event.
        const proofPage = await context.newPage();
        const response = await proofPage.goto(base + "/staff/payslips", { waitUntil: "commit" });
        await proofPage.getByRole("button", { name: /Request verification code/ }).waitFor();
        assert.ok(response.status() < 500 && new URL(proofPage.url()).pathname === "/staff/login", "STAFF_LOGOUT_CACHE_FAILURE");
        assert.ok(!(await proofPage.locator("body").innerText()).includes(member.fullName), "STAFF_LOGOUT_DATA_LEAK");
        const denial = await proofPage.evaluate(async () => {
          const me = await fetch("/api/employee-auth/me");
          const protectedResponse = await fetch("/staff/payslips");
          return { meStatus: me.status, status: protectedResponse.status, body: await protectedResponse.text() };
        });
        assert.equal(denial.meStatus, 401, "STAFF_LOGOUT_API_AUTH_FAILURE");
        assert.ok(denial.status < 500 && !denial.body.includes(member.fullName), "STAFF_LOGOUT_RESPONSE_DATA_LEAK");
        await proofPage.close();
        assert.equal(await prisma.employeeSession.count({ where: { membershipId: member.id, revokedAt: null, expiresAt: { gt: new Date() } } }), 0, "STAFF_SESSION_NOT_REVOKED");
        report({ stage: "STAFF_LOGOUT", status: "PASS" });
      } } finally { await context.close(); }
    }
  } else if (name === "staff-cleanup-diagnose") {
    await login("BUSINESS_OWNER");
    for (const context of kit.getContext().browser().contexts()) {
      if (context === kit.getContext()) continue;
      try {
        const page = context.pages()[0];
        const me = await page.evaluate(async () => (await fetch("/api/employee-auth/me")).status);
        report({ stage: "STAFF_LOGOUT_DIAGNOSTIC", path: new URL(page.url()).pathname, meStatus: me, headings: await page.locator("h1,h2").allTextContents(), activeSessions: await prisma.employeeSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }) });
      } finally { await context.close(); }
    }
  } else if (name === "hr-boundaries") {
    const coreA = await prisma.employeeBusinessMembership.findUniqueOrThrow({ where: { id: kit.core.employeeMemberships["CORE-A"].membershipId } });
    const boundary = await prisma.employeeBusinessMembership.findFirstOrThrow({ where: { businessId: coreA.businessId, fullName: "Synthetic Branch Boundary Employee" } });
    const otherTenant = await prisma.employeeBusinessMembership.findFirstOrThrow({ where: { business: { name: "Tetamu HR Boundary Test" } } });
    await login("BUSINESS_OWNER");
    let page = getPage();
    await page.goto(base + "/team?section=people&testAccounts=show");
    const coreLink = page.getByRole("link", { name: new RegExp(coreA.fullName) }).first();
    const coreHref = await coreLink.getAttribute("href");
    await coreLink.click();
    await page.locator("h1").filter({ hasText: coreA.fullName }).waitFor();
    assert.ok((await page.locator("body").innerText()).includes(coreA.fullName), "OWNER_DETAIL_MISSING");
    report({ stage: "OWNER_EXISTING_DETAIL", status: "PASS" });
    await login("BRANCH_MANAGER"); page = getPage();
    await page.goto(base + "/team?section=people&testAccounts=show");
    const list = await page.locator("body").innerText();
    assert.ok(list.includes(boundary.fullName) && !list.includes(coreA.fullName), "BRANCH_LIST_SCOPE_FAILURE");
    const ownLink = page.getByRole("link", { name: new RegExp(boundary.fullName) }).first();
    await ownLink.click();
    await page.locator("h1").filter({ hasText: boundary.fullName }).waitFor();
    assert.ok((await page.locator("body").innerText()).includes(boundary.fullName), "BRANCH_OWN_DETAIL_MISSING");
    report({ stage: "BRANCH_OWN_LIST_AND_DETAIL", status: "PASS" });
    for (const [target, label] of [[coreA, "CROSS_BRANCH"], [otherTenant, "CROSS_TENANT"]]) {
      const targetPath = target.id === coreA.id ? coreHref : `/team/people/${target.id}`;
      const response = await page.goto(base + targetPath);
      const body = await response.text(), visible = await page.locator("body").innerText();
      assert.ok([401,403,404].includes(response.status()) || new URL(page.url()).pathname !== new URL(targetPath, base).pathname, "EMPLOYEE_DEEP_LINK_NOT_DENIED");
      for (const value of [target.fullName, target.phoneNumber, target.phoneNumberNormalized].filter(Boolean)) assert.ok(!body.includes(value) && !visible.includes(value), "EMPLOYEE_DATA_LEAK");
      report({ stage: label + "_DENIAL", status: "PASS", leaked: false });
    }
    for (const path of ["/team/payroll/workspace", "/team/payroll/payments", "/team/payroll/statutory"]) {
      const response = await page.goto(base + path);
      const text = await page.locator("body").innerText();
      assert.ok([401,403,404].includes(response.status()) || new URL(page.url()).pathname !== path || /access denied|not authorized|do not have|restricted|not available/i.test(text), "PAYROLL_DENIAL_MISSING");
      assert.ok(!text.includes(coreA.fullName), "PAYROLL_DATA_LEAK");
      report({ stage: "BRANCH_PAYROLL_DENIAL", route: path, status: "PASS" });
    }
    await login("GROUP_MANAGER"); page = getPage();
    const response = await page.goto(base + "/team/attendance");
    assert.equal(response.status(), 200); assert.equal(new URL(page.url()).pathname, "/team/attendance");
    report({ stage: "GROUP_MANAGER_ATTENDANCE", status: "PASS" });
  } else if (name === "pos-isolation") {
    await login("SALON"); const page = getPage();
    const actor = await prisma.user.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" }, branch: { name: "Branch A" }, role: "STAFF", permissions: { has: "CRM" }, NOT: { permissions: { has: "ALL_BRANCHES" } } } });
    await page.goto(base + "/team");
    await page.getByRole("button", { name: /^(Sign out|Log out|Logout)$/i }).first().click();
    await page.getByLabel("Email", { exact: true }).waitFor();
    await page.getByLabel("Email", { exact: true }).fill(actor.email);
    await page.getByLabel("Password", { exact: true }).fill(kit.runtime.LOCAL_POS_CORE_UAT_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(url => url.pathname !== "/login");
    const own = await prisma.appointment.findFirstOrThrow({ where: { businessId: actor.businessId, branchId: actor.branchId } });
    const outside = await prisma.appointment.findFirstOrThrow({ where: { businessId: actor.businessId, branchId: { not: actor.branchId } }, include: { customer: true } });
    const foreignCustomer = await prisma.customer.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-auto" } } });
    const foreignVehicle = await prisma.vehicle.findFirstOrThrow({ where: { businessId: foreignCustomer.businessId }, include: { customer: true } });
    const ownResponse = await page.goto(`${base}/appointments/${own.id}?legacy=1`);
    assert.equal(ownResponse.status(), 200, "POS_OWN_BRANCH_DENIED");
    report({ stage: "POS_OWN_BRANCH_APPOINTMENT", status: "PASS" });
    for (const [label, path, sensitive] of [
      ["POS_CROSS_BRANCH_APPOINTMENT", `/appointments/${outside.id}?legacy=1`, [outside.customer.phone]],
      ["POS_CROSS_TENANT_CUSTOMER", `/crm/customers/${foreignCustomer.id}`, [foreignCustomer.phone]],
      ["POS_CROSS_TENANT_VEHICLE", `/crm/vehicles/${foreignVehicle.id}`, [foreignVehicle.plateNumber, foreignVehicle.customer.phone]],
    ]) {
      const proof = await page.evaluate(async path => { const response = await fetch(path); return { status: response.status, body: await response.text() }; }, path);
      assert.equal(proof.status, 404, "POS_SCOPE_DENIAL_REQUIRED");
      await page.goto(base + path);
      const visible = await page.locator("body").innerText();
      for (const value of sensitive.filter(Boolean)) {
        assert.ok(!proof.body.includes(value) && !visible.includes(value), "POS_SCOPE_DATA_LEAK");
      }
      report({ stage: label, status: "PASS", leaked: false });
    }
    // The framework's global 404 has no app logout control. Return to the
    // authenticated shell so final cleanup can perform the normal UI logout.
    await page.goto(base + "/team");
  } else if (name === "package-purchase") {
    await login("SALON"); const page = getPage();
    await ensureSalonShift();
    await page.goto(base + "/cashier");
    const close = page.getByRole("button", { name: "Close customer picker", exact: true });
    if (await close.isVisible()) await close.click();
    await page.waitForFunction(() => {
      const button = [...document.querySelectorAll("button")].find(n => n.textContent.trim() === "Packages");
      const key = button && Object.keys(button).find(k => k.startsWith("__reactProps$"));
      return key && typeof button[key]?.onClick === "function";
    });
    report({ stage: "PACKAGE_CATALOG_HYDRATED" });
    await page.getByRole("tab", { name: "Packages", exact: true }).click();
    report({ stage: "PACKAGE_TAB_CLICKED" });
    await page.getByRole("button", { name: /^Haircut 3-Visit Pass/ }).click();
    await page.getByRole("button", { name: /Select customer.*Choose/ }).click();
    await page.getByPlaceholder("Phone or customer name", { exact: true }).fill("UAT Customer A");
    await page.getByRole("button", { name: /UAT Customer A/ }).click();
    await page.getByRole("button", { name: /^Payment ·/ }).click();
    await page.getByRole("button", { name: /^Exact RM120/ }).click();
    await page.getByRole("button", { name: /^Confirm payment ·/ }).click();
    await page.getByRole("heading", { name: "Invoice", exact: true }).waitFor();
    const purchased = await prisma.customerPackage.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" }, customer: { name: "UAT Customer A" } }, orderBy: { createdAt: "desc" } });
    assert.equal(purchased.remainingUses, 3, "PACKAGE_PURCHASE_BALANCE");
    report({ stage: "PACKAGE_PURCHASE_CASH_PAYMENT", status: "PASS" });
  } else if (name === "package-redeem") {
    const page = getPage();
    const appointment = await prisma.appointment.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" } }, orderBy: { createdAt: "desc" } });
    await page.goto(`${base}/appointments/${appointment.id}`);
    if (appointment.status !== "COMPLETED") {
      await page.getByRole("button", { name: /^Complete service$/i }).click();
      await page.waitForLoadState("networkidle");
      assert.equal((await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status, "COMPLETED");
    }
    const purchased = await prisma.customerPackage.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" }, customer: { name: "UAT Customer A" } }, orderBy: { createdAt: "desc" } });
    await page.getByRole("link", { name: "Payment & Invoice", exact: true }).click();
    await page.getByRole("button", { name: /^Payment ·/ }).click();
    await page.getByRole("button", { name: /Haircut 3-Visit Pass.*3\/3 uses/ }).click();
    await page.getByRole("button", { name: /^Confirm payment ·/ }).click();
    await page.getByRole("heading", { name: "Invoice", exact: true }).waitFor();
    const redeemed = await prisma.customerPackage.findUniqueOrThrow({ where: { id: purchased.id } });
    assert.equal(redeemed.remainingUses, purchased.remainingUses - 1, "PACKAGE_REDEMPTION_BALANCE");
    const paidAppointment = await prisma.appointment.findFirstOrThrow({ where: { businessId: purchased.businessId }, orderBy: { createdAt: "desc" }, include: { invoice: true, payments: true } });
    assert.equal(paidAppointment.invoice.status, "PAID", "PACKAGE_INVOICE_UNPAID");
    assert.equal(paidAppointment.payments.filter(p => p.method === "PACKAGE").length, 1, "PACKAGE_REDEMPTION_COUNT");
    report({ stage: "PACKAGE_REDEMPTION_BALANCE_INVOICE", status: "PASS" });
  } else if (name === "package-refund-proof") {
    const payment = await prisma.payment.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" }, method: "PACKAGE" }, orderBy: { paidAt: "desc" }, include: { customerPackage: true, refunds: true } });
    await getPage().goto(`${base}/invoices/${payment.invoiceId}`);
    report({ stage: "PACKAGE_REFUND_DIAGNOSTIC", refunds: payment.refunds.length, remainingUses: payment.customerPackage.remainingUses,
      creditNoteVisible: await getPage().getByRole("heading", { name: "Credit Note", exact: true }).count(),
      formVisible: await getPage().getByRole("button", { name: "Process refund", exact: true }).count() });
  } else if (name === "package-refund") {
    await login("SALON"); const page = getPage();
    const payment = await prisma.payment.findFirstOrThrow({ where: { business: { slug: "tetamu-uat-salon" }, method: "PACKAGE" }, orderBy: { paidAt: "desc" }, include: { customerPackage: true } });
    await page.goto(`${base}/invoices/${payment.invoiceId}`);
    await page.locator('textarea[name="reason"]').fill("Local synthetic package-use restoration verification");
    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Process refund", exact: true }).click();
    // A full package refund removes the now-unrefundable form and its transient
    // success message. The persisted Credit Note is the stable success marker.
    await page.getByRole("heading", { name: "Credit Note", exact: true }).waitFor();
    const restored = await prisma.customerPackage.findUniqueOrThrow({ where: { id: payment.customerPackageId } });
    assert.equal(restored.remainingUses, payment.customerPackage.remainingUses + 1, "PACKAGE_REFUND_USE_NOT_RESTORED");
    const refund = await prisma.paymentRefund.findFirstOrThrow({ where: { paymentId: payment.id } });
    assert.equal(refund.method, "PACKAGE"); assert.equal(refund.packageUsesRestored, 1);
    report({ stage: "PACKAGE_REDEMPTION_REFUND_RESTORES_ONE_USE", status: "PASS" });
  } else if (name === "disabled-features") {
    await login("BUSINESS_OWNER"); const page = getPage();
    const owner = kit.personas.find((p) => p.persona === "BUSINESS_OWNER");
    const user = await prisma.user.findFirstOrThrow({ where: { email: owner.email } });
    // Owned disposable fixture only: grant the module entitlement so the
    // in-module deny is tested, not merely the outer module-not-enabled guard.
    assert.equal(new URL(base).hostname, "127.0.0.1");
    await prisma.businessModuleEntitlement.upsert({ where: { businessId_moduleKey: { businessId: user.businessId, moduleKey: "STATUTORY" } },
      create: { businessId: user.businessId, moduleKey: "STATUTORY", status: "ENABLED", source: "MANUAL", enabledFrom: new Date("2020-01-01") }, update: { status: "ENABLED" } });
    for (const path of ["/team/payroll/payments", "/team/payroll/statutory"]) {
      await page.goto(base + path);
      await page.getByText(/Not enabled/).first().waitFor();
    }
    const result = await page.evaluate(async () => {
      const response = await fetch("/team/payroll/statutory/export?provider=PCB&month=2026-09");
      return { status: response.status, body: await response.text(), disposition: response.headers.get("content-disposition"), cache: response.headers.get("cache-control") };
    });
    assert.equal(result.status, 403); assert.equal(result.disposition, null);
    assert.match(result.body, /Not enabled/); assert.match(result.cache, /no-store/);
    report({ stage: "PCB_HTTP_EXPORT_AND_DISABLED_UI", status: "PASS" });
  } else if (name === "published-pcb-correction") {
    await login("BUSINESS_OWNER"); const page = getPage();
    const owner = await prisma.user.findFirstOrThrow({ where: { email: kit.personas.find(p => p.persona === "BUSINESS_OWNER").email } });
    const publication = await prisma.payrollPayslipPublication.findFirstOrThrow({ where: { businessId: owner.businessId,
      membershipId: kit.personas.find(p => p.persona === "STAFF").membershipId } });
    const original = await prisma.payrollPcbPublicationVersion.findFirstOrThrow({ where: { publicationId: publication.id, version: 1 } });
    report({ stage: "PCB_BROWSER_SOURCE_FOUND" });
    await page.goto(`${base}/team/payroll/payslips/${publication.payrollEntryId}/history`);
    await page.getByRole("heading", { name: "Publish a PCB correction", exact: true }).waitFor();
    report({ stage: "PCB_BROWSER_FORM_FOUND" });
    const unregister = (await import("tsx/cjs/api")).register();
    const require = createRequire(import.meta.url);
    let crypto, totp;
    try { crypto = require("../src/lib/auth/mfa-crypto.ts"); totp = require("../src/lib/auth/mfa-totp.ts"); }
    finally { unregister(); }
    const credential = await prisma.userMfaCredential.findFirstOrThrow({ where: { userId: owner.id, status: "ACTIVE" } });
    const secret = crypto.decryptMfaSecret({ ...credential, credentialId: credential.id }, kit.runtime);
    const code = totp.generateTotpCode({ secret, timestamp: Date.now() });
    report({ stage: "PCB_BROWSER_FACTOR_PREPARED" });
    await page.locator('textarea[name="reason"]').fill("Explicit local synthetic historical correction proof");
    await page.locator('input[name="amount"]').fill(original.amount.add(1).toFixed(2));
    await page.locator('input[name="externalReference"]').fill("RC_BROWSER_SYNTHETIC_CORRECTION");
    await page.locator('input[name="confirmed"]').check();
    await page.locator('input[name="stepUpPassword"]').fill(kit.runtime.HR_EIGHT_ROLE_UAT_PASSWORD);
    await page.locator('input[name="stepUpCode"]').fill(code);
    await page.getByRole("button", { name: "Publish corrected payslip", exact: true }).click();
    await page.waitForURL(url => !url.pathname.endsWith("/history"));
    const latest = await prisma.payrollPcbPublicationVersion.findFirstOrThrow({ where: { publicationId: publication.id }, orderBy: { version: "desc" } });
    assert.equal(latest.version, 2, "PCB_UI_CORRECTION_NOT_PUBLISHED");
    assert.equal((await prisma.payrollPayslipPublication.findUniqueOrThrow({ where: { id: publication.id } })).documentSha256, publication.documentSha256, "PCB_ORIGINAL_PDF_CHANGED");
    await page.goto(`${base}/team/payroll/payslips/${publication.payrollEntryId}/history`);
    await page.getByText(/Corrected — supersedes previous version/).waitFor();
    for (const version of [1, 2]) {
      const result = await page.evaluate(async path => { const response = await fetch(path); return { status: response.status, text: await response.text() }; }, `/team/payroll/payslips/${publication.payrollEntryId}?version=${version}`);
      assert.equal(result.status, 200); assert.equal(result.text.includes("Corrected"), version === 2);
    }
    report({ stage: "PUBLISHED_PCB_UI_MFA_APPEND_VERSION_HISTORY", status: "PASS", originalPreserved: true });
  } else if (name === "mobile-critical") {
    for (const role of ["AUTO", "SALON", "BUSINESS_OWNER", "BRANCH_MANAGER"]) {
      await login(role); const page = getPage(); await page.setViewportSize({ width: 390, height: 844 });
      const paths = role === "AUTO" ? ["/work-orders", "/crm", "/invoices", "/reports"] : role === "SALON" ? ["/cashier", "/appointments", "/packages"]
        : role === "BUSINESS_OWNER" ? ["/team", "/team/attendance", "/team/payroll/workspace"] : ["/team/employees?testAccounts=show", "/team/leave", "/team/claims"];
      for (const path of paths) {
        const response = await page.goto(base + path); await page.locator("main").first().waitFor();
        assert.equal(response.status(), 200); assert.equal(new URL(page.url()).pathname, path.split("?")[0]);
        assert.equal(await page.getByText(/Application error:|Internal Server Error/).count(), 0);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        assert.equal(overflow, false, "MOBILE_DOCUMENT_OVERFLOW");
        report({ stage: "MOBILE_CRITICAL", role, route: path.split("?")[0], status: "PASS" });
      }
    }
  } else if (name === "navigation") {
    for (const role of ["AUTO", "SALON", "BUSINESS_OWNER", "PAYROLL_ADMIN", "HR_MANAGER", "BRANCH_MANAGER", "SUPERVISOR", "GROUP_OWNER", "GROUP_MANAGER"]) {
      await login(role);
      const paths = role === "AUTO" ? ["/work-orders", "/crm", "/crm/vehicles", "/services", "/invoices", "/closing", "/reports", "/dashboard"]
        : role === "SALON" ? ["/cashier", "/appointments", "/packages", "/invoices", "/reports"]
        : role === "PAYROLL_ADMIN" ? ["/team/payroll/workspace", "/team/attendance/timesheets"]
        : role.startsWith("GROUP_") ? ["/team/attendance", "/team/roster"]
        : role === "SUPERVISOR" ? ["/team/attendance", "/team/roster", "/team/leave"]
        : [...(role === "BUSINESS_OWNER" ? ["/team"] : []), "/team/employees?testAccounts=show", "/team/attendance", "/team/roster", "/team/leave", "/team/claims"];
      for (const path of paths) {
        const page = getPage(); const response = await page.goto(base + path);
          await page.locator("main").first().waitFor();
          assert.ok((await page.locator("body").innerText()).length > 100, "NAVIGATION_BLANK_PAGE");
        assert.equal(response.status(), 200, "NAVIGATION_HTTP_FAILURE");
        assert.equal(new URL(page.url()).pathname, path.split("?")[0], "NAVIGATION_UNEXPECTED_REDIRECT");
        assert.equal(await page.getByText(/Application error:|Internal Server Error/).count(), 0, "NAVIGATION_ERROR_PAGE");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
        report({ stage: "NAVIGATION", role, route: path.split("?")[0], status: overflow ? "NEEDS_IMPROVEMENT" : "PASS", overflow });
      }
    }
  } else throw new Error("SCENARIO_UNKNOWN");
}
