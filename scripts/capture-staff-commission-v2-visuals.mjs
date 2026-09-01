import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, ".tmp", "staff-commission-v2-visual-fixtures.json");
const outputDir = path.join(root, "artifacts", "staff-commission-v2");
const baseUrl = process.env.STAFF_VISUAL_BASE_URL ?? "http://localhost:3200";
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const chrome = findChrome();
const cases = [
  { name: "populated-360x800", state: "multiplePeriods", width: 360, height: 800, expect: "Added to payroll", lines: 3 },
  { name: "populated-390x844", state: "multiplePeriods", width: 390, height: 844, expect: "Added to payroll", lines: 3 },
  { name: "populated-412x915", state: "multiplePeriods", width: 412, height: 915, expect: "Added to payroll", lines: 3 },
  { name: "awaiting-review-390x844", state: "calculated", width: 390, height: 844, expect: "Awaiting review", lines: 1 },
  { name: "approved-390x844", state: "approved", width: 390, height: 844, expect: "Approved", lines: 2 },
  { name: "added-to-payroll-390x844", state: "appliedToPayroll", width: 390, height: 844, expect: "Added to payroll", lines: 3 },
  { name: "multiple-periods-390x844", state: "multiplePeriods", width: 390, height: 844, expect: "August 2026", lines: 3 },
  { name: "positive-adjustment-390x844", state: "positiveAdjustment", width: 390, height: 844, expect: "+RM", lines: 1 },
  { name: "large-negative-adjustment-360x800", state: "largeTotal", width: 360, height: 800, expect: "123,456.78", lines: 1 },
  { name: "empty-390x844", state: "noStatement", width: 390, height: 844, expect: "No commission statement yet.", lines: 0 },
  { name: "zero-lines-390x844", state: "zeroBreakdownLines", width: 390, height: 844, expect: "No commission lines for this period.", lines: 0 },
  { name: "manager-as-employee-390x844", state: "managerAsEmployee", width: 390, height: 844, expect: "Total commission", lines: 1 },
];

await mkdir(outputDir, { recursive: true });
const results = [];
for (const testCase of cases) results.push(await capture(testCase));
await writeFile(path.join(outputDir, "staff-commission-v2-layout-metrics.json"), `${JSON.stringify({ baseUrl, capturedAt: new Date().toISOString(), results }, null, 2)}\n`);
console.log(`Captured ${results.length} Commission V2 visual states.`);
for (const result of results) console.log(`${result.name}: width ${result.metrics.scrollWidth}/${result.metrics.innerWidth}; lines ${result.metrics.lineCount}; bottom ${result.metrics.bottomClearancePx}px`);

async function capture(testCase) {
  const profileDir = path.join(root, ".tmp", `commission-v2-chrome-${testCase.name}`);
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });
  const handle = spawn(chrome, [
    "--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update",
    "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`, "about:blank",
  ], { stdio: "ignore" });
  try {
    const portFile = path.join(profileDir, "DevToolsActivePort");
    await waitFor(() => existsSync(portFile), 10_000, "Chrome DevTools port");
    const [port] = (await readFile(portFile, "utf8")).trim().split(/\r?\n/);
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json());
    const target = targets.find((item) => item.type === "page");
    if (!target?.webSocketDebuggerUrl) throw new Error("Chrome page target was not available.");
    const cdp = createCdp(target.webSocketDebuggerUrl);
    await cdp.open;
    await Promise.all([cdp.send("Page.enable"), cdp.send("Runtime.enable"), cdp.send("Network.enable")]);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: testCase.width, height: testCase.height, deviceScaleFactor: 1, mobile: true,
      screenWidth: testCase.width, screenHeight: testCase.height,
    });
    await cdp.send("Network.setCookie", {
      name: "tetamu_employee_session", value: fixture[testCase.state].sessionToken,
      url: baseUrl, httpOnly: true, secure: false, sameSite: "Lax",
    });
    const period = fixture[testCase.state].periodId;
    const url = `${baseUrl}/staff/commission${period ? `?period=${encodeURIComponent(period)}` : ""}`;
    await cdp.send("Page.navigate", { url });
    await waitForPage(cdp, testCase.expect);
    const metrics = await evaluate(cdp, `(() => {
      const page = document.querySelector('[aria-label="Commission"]');
      const nav = document.querySelector('nav[aria-label="Staff navigation"]');
      const lines = [...document.querySelectorAll('[aria-label="Commission breakdown"] details[role="listitem"]')];
      const controls = [...document.querySelectorAll('nav[aria-label="Commission earning period"] a, nav[aria-label="Commission earning period"] [aria-disabled="true"]')];
      window.scrollTo(0, document.documentElement.scrollHeight);
      const pageRect = page?.getBoundingClientRect();
      const navRect = nav?.getBoundingClientRect();
      const bottomClearancePx = pageRect && navRect ? Math.round(navRect.top - pageRect.bottom) : null;
      window.scrollTo(0, 0);
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        h1Count: document.querySelectorAll('h1').length,
        h1: document.querySelector('h1')?.textContent?.trim() ?? null,
        expectedCopyVisible: document.body.innerText.includes(${JSON.stringify(testCase.expect)}),
        lineCount: lines.length,
        oneActionPerLine: lines.every((line) => line.querySelectorAll('summary').length === 1 && line.querySelectorAll('a,button').length === 0),
        minimumActionHeightPx: lines.length ? Math.round(Math.min(...lines.map((line) => line.querySelector('summary').getBoundingClientRect().height))) : null,
        clippedLines: lines.filter((line) => { const rect = line.getBoundingClientRect(); return rect.left < -0.5 || rect.right > window.innerWidth + 0.5; }).length,
        periodControlCount: controls.length,
        bottomClearancePx,
      };
    })()`);
    if (metrics.scrollWidth !== metrics.innerWidth) throw new Error(`${testCase.name} has horizontal overflow.`);
    if (metrics.h1Count !== 1 || metrics.h1 !== "Commission") throw new Error(`${testCase.name} has invalid heading structure.`);
    if (metrics.lineCount !== testCase.lines) throw new Error(`${testCase.name} expected ${testCase.lines} lines, received ${metrics.lineCount}.`);
    if (metrics.lineCount && (!metrics.oneActionPerLine || metrics.minimumActionHeightPx < 44 || metrics.clippedLines)) throw new Error(`${testCase.name} failed line interaction/layout acceptance.`);
    if (period && metrics.periodControlCount !== 2) throw new Error(`${testCase.name} period controls are incomplete.`);
    if (metrics.bottomClearancePx !== null && metrics.bottomClearancePx < 0) throw new Error(`${testCase.name} is obscured by bottom navigation.`);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    await writeFile(path.join(outputDir, `${testCase.name}.png`), Buffer.from(screenshot.data, "base64"));
    cdp.close();
    return { ...testCase, metrics };
  } finally {
    handle.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await rm(profileDir, { recursive: true, force: true });
  }
}

function createCdp(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let id = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  return {
    open: new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); }),
    send(method, params = {}) { const requestId = ++id; return new Promise((resolve, reject) => { pending.set(requestId, { resolve, reject }); socket.send(JSON.stringify({ id: requestId, method, params })); }); },
    close() { socket.close(); },
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForPage(cdp, expectedText) {
  await waitFor(async () => {
    const state = await evaluate(cdp, `({ ready: document.readyState, body: document.body?.innerText ?? '' })`);
    return state.ready === "complete" && state.body.includes("Commission") && state.body.includes(expectedText);
  }, 30_000, `Commission copy: ${expectedText}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function waitFor(check, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error("Google Chrome executable was not found.");
  return found;
}
