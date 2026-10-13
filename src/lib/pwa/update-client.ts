export type UpdateState = "upToDate" | "updateAvailable" | "applyingUpdate" | "recoveryRequired";

const CHECK_INTERVAL = 20 * 60 * 1000;
const RECOVERY_KEY = "tetamu-runtime-recovery-attempted";
const validVersion = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);

export function isChunkFailure(value: unknown): boolean {
  const text = value instanceof Error ? `${value.name}: ${value.message}` : typeof value === "string" ? value : "";
  return /\bChunkLoadError\b|\bLoading chunk [\w-]+ failed\b|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text);
}

// Browser I/O is kept here so the React component only renders update state.
// No business state, cache eviction or mutation requests are handled by this client.
export function startPwaUpdates(win: Window, buildVersion: string, notify: (state: UpdateState) => void, reload = () => win.location.reload()) {
  const workers = win.navigator.serviceWorker;
  let registration: ServiceWorkerRegistration | undefined;
  let targetVersion = buildVersion;
  let state: UpdateState = "upToDate";
  let stopped = false, checking = false, requested = false, reloaded = false;
  let lastCheck = 0;
  let checkGeneration = 0;
  let cancelCheck = () => {};
  let detachRegistration = () => {};
  const emit = (next: UpdateState) => { if (!stopped) { state = next; notify(next); } };
  const getFlag = (key: string) => { try { return win.sessionStorage.getItem(key) === "1"; } catch { return false; } };
  const setFlag = (key: string) => { try { win.sessionStorage.setItem(key, "1"); } catch { /* User-triggered only; the in-memory guard remains. */ } };

  function reloadOnce() {
    if (stopped || !requested || reloaded) return;
    const key = "tetamu-pwa-reloaded-" + targetVersion;
    if (getFlag(key)) { requested = false; emit("recoveryRequired"); return; }
    reloaded = true; setFlag(key); reload();
  }
  function observe(next: ServiceWorkerRegistration) {
    const installed = () => {
      if (next.waiting && workers.controller && state !== "applyingUpdate") {
        const candidate = new URL(next.waiting.scriptURL).searchParams.get("v");
        if (validVersion(candidate)) targetVersion = candidate.toLowerCase();
        emit("updateAvailable");
      }
    };
    if (registration === next) { installed(); return; }
    detachRegistration(); registration = next;
    let installing: ServiceWorker | null = null;
    const found = () => {
      installing?.removeEventListener("statechange", installed);
      installing = next.installing;
      installing?.addEventListener("statechange", installed);
      installed();
    };
    next.addEventListener("updatefound", found); found();
    detachRegistration = () => { next.removeEventListener("updatefound", found); installing?.removeEventListener("statechange", installed); };
  }
  async function check() {
    if (stopped || checking || (lastCheck && Date.now() - lastCheck < 60_000)) return;
    checking = true; lastCheck = Date.now();
    const generation = ++checkGeneration;
    const alive = () => !stopped && generation === checkGeneration;
    const abort = new AbortController();
    let timer = 0;
    const timeout = new Promise<never>((_, reject) => {
      cancelCheck = () => { abort.abort(); reject(new Error("Update check interrupted")); };
      timer = win.setTimeout(cancelCheck, 10_000);
    });
    const work = async () => {
      // An already downloaded update remains discoverable even while offline.
      const existing = await workers.getRegistration("/");
      const existingWorker = existing?.waiting ?? existing?.active;
      if (!alive()) return;
      if (existing && existingWorker && new URL(existingWorker.scriptURL).origin === win.location.origin &&
          new URL(existingWorker.scriptURL).pathname === "/sw.js") observe(existing);
      const response = await win.fetch("/api/app-version", { cache: "no-store", credentials: "same-origin", signal: abort.signal });
      if (!response.ok || !alive()) return;
      const data: unknown = await response.json();
      const version = data && typeof data === "object" && "version" in data ? data.version : null;
      if (!validVersion(version) || !alive()) return;
      targetVersion = version.toLowerCase();
      const next = await workers.register(`/sw.js?v=${targetVersion}`, { scope: "/", updateViaCache: "none" });
      if (!alive()) return;
      observe(next);
      if ((next.waiting || targetVersion !== buildVersion) && state !== "applyingUpdate") emit("updateAvailable");
      await next.update();
    };
    try {
      await Promise.race([work(), timeout]);
    } catch { /* Offline or unavailable metadata: leave the running app untouched. */ }
    finally { win.clearTimeout(timer); if (generation === checkGeneration) { checking = false; checkGeneration++; } }
  }
  const foreground = () => { if (win.document.visibilityState !== "hidden") void check(); };
  const controllerChanged = () => reloadOnce();
  const failure = (error: unknown) => { if (isChunkFailure(error)) emit("recoveryRequired"); };
  const onError = (event: ErrorEvent) => failure(event.error ?? event.message);
  const onRejected = (event: PromiseRejectionEvent) => failure(event.reason);
  workers.addEventListener("controllerchange", controllerChanged);
  win.addEventListener("focus", foreground);
  win.document.addEventListener("visibilitychange", foreground);
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejected);
  const interval = win.setInterval(() => { void check(); }, CHECK_INTERVAL);
  void check();
  return {
    refresh() {
      if (stopped || reloaded || state === "applyingUpdate") return;
      // A repeated failure requires another explicit user click. Never retry in a loop.
      if (state === "recoveryRequired" && (getFlag(RECOVERY_KEY) || getFlag("tetamu-pwa-reloaded-" + targetVersion))) {
        reloaded = true; reload(); return;
      }
      if (state === "recoveryRequired") setFlag(RECOVERY_KEY);
      requested = true;
      emit("applyingUpdate");
      if (registration?.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
      else reloadOnce();
    },
    stop() {
      stopped = true; cancelCheck(); detachRegistration(); win.clearInterval(interval);
      workers.removeEventListener("controllerchange", controllerChanged);
      win.removeEventListener("focus", foreground);
      win.document.removeEventListener("visibilitychange", foreground);
      win.removeEventListener("error", onError);
      win.removeEventListener("unhandledrejection", onRejected);
    },
  };
}
