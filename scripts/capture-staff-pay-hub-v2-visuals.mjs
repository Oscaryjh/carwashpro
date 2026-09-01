import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const fixturePath = path.join(root, ".tmp", "staff-pay-hub-v2-visual-fixtures.json");
const outputDir = path.join(root, "artifacts", "staff-pay-hub-v2");
const baseUrl = process.env.STAFF_VISUAL_BASE_URL ?? "http://localhost:3200";

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const chrome = findChrome();
const cases = [
  { name: "published-360x800", state: "normal", width: 360, height: 800, expect: "Download PDF" },
  { name: "published-390x844", state: "normal", width: 390, height: 844, expect: "Download PDF" },
  { name: "published-412x915", state: "normal", width: 412, height: 915, expect: "Download PDF" },
  { name: "no-publication-390x844", state: "noPublication", width: 390, height: 844, expect: "Payslip not available yet." },
  { name: "manager-as-employee-390x844", state: "longLarge", width: 390, height: 844, expect: "RM\u00a0123,456.78" },
  { name: "long-large-amount-360x800", state: "longLarge", width: 360, height: 800, expect: "RM\u00a0123,456.78" },
];

await mkdir(outputDir, { recursive: true });
const results = [];

for (const testCase of cases) {
  results.push(await capture(testCase));
}

await writeFile(
  path.join(outputDir, "staff-pay-hub-v2-layout-metrics.json"),
  `${JSON.stringify({ baseUrl, capturedAt: new Date().toISOString(), results }, null, 2)}\n`,
);

console.log(`Captured ${results.length} Pay Hub V2 visual states.`);
for (const result of results) {
  console.log(`${result.name}: ${result.metrics.scrollWidth}/${result.metrics.innerWidth}, bottom gap ${result.metrics.bottomClearancePx}px`);
}

async function capture(testCase) {
  const profileDir = path.join(root, ".tmp", `pay-hub-chrome-${testCase.name}`);
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(profileDir, { recursive: true });

  const processHandle = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
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
    await Promise.all([
      cdp.send("Page.enable"),
      cdp.send("Runtime.enable"),
      cdp.send("Network.enable"),
    ]);
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: testCase.width,
      height: testCase.height,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: testCase.width,
      screenHeight: testCase.height,
    });
    await cdp.send("Network.setCookie", {
      name: "tetamu_employee_session",
      value: fixture[testCase.state].sessionToken,
      url: baseUrl,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    });
    await cdp.send("Page.navigate", { url: `${baseUrl}/staff/pay` });
    await waitForPage(cdp, testCase.expect);

    const metrics = await evaluate(cdp, `(() => {
      const visibleTargets = [...document.querySelectorAll('a,button')]
        .map((element) => ({ label: (element.getAttribute('aria-label') || element.textContent || '').trim(), rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0);
      const nav = document.querySelector('nav[aria-label="Staff navigation"]');
      const pay = document.querySelector('[aria-label="Pay"]');
      const initialScrollY = window.scrollY;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const navRect = nav?.getBoundingClientRect();
      const payRect = pay?.getBoundingClientRect();
      const bottomClearancePx = navRect && payRect ? Math.round(navRect.top - payRect.bottom) : null;
      window.scrollTo(0, initialScrollY);
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        h1: document.querySelector('h1')?.textContent?.trim() ?? null,
        expectedCopyVisible: document.body.innerText.includes(${JSON.stringify(testCase.expect)}),
        bottomClearancePx,
        minimumTouchWidthPx: Math.round(Math.min(...visibleTargets.map(({ rect }) => rect.width))),
        minimumTouchHeightPx: Math.round(Math.min(...visibleTargets.map(({ rect }) => rect.height))),
        clippedTargets: visibleTargets.filter(({ rect }) => rect.right > window.innerWidth + 0.5 || rect.left < -0.5).map(({ label }) => label),
      };
    })()`);

    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(path.join(outputDir, `${testCase.name}.png`), Buffer.from(screenshot.data, "base64"));
    cdp.close();

    return { ...testCase, metrics };
  } finally {
    processHandle.kill();
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
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    open: new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    }),
    send(method, params = {}) {
      const requestId = ++id;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    },
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
    return state.ready === "complete" && state.body.includes("Pay") && state.body.includes(expectedText);
  }, 20_000, `Pay Hub copy: ${expectedText}`);
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
