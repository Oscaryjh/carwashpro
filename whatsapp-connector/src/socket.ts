import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket
} from "@whiskeysockets/baileys";
import { promises as fs } from "node:fs";
import path from "node:path";

import { logger } from "./logger.js";
import { getReconnectDelayMs } from "./reconnect.js";
import type { ConnectorState } from "./types.js";

let socket: WASocket | null = null;
let connecting: Promise<WASocket> | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let suppressReconnect = false;

const clientName = "WashFlow Connector";

const connectorState: ConnectorState = {
  status: "starting",
  startedAt: new Date().toISOString(),
  reconnectAttempts: 0
};

const qrWaiters = new Set<{
  resolve: (qr: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}>();

function getAuthInfoPath() {
  const authInfoPath = process.env.AUTH_INFO_PATH;

  if (!authInfoPath) {
    throw new Error("AUTH_INFO_PATH is required.");
  }

  return authInfoPath;
}

function getDisconnectStatusCode(error: unknown) {
  return (error as { output?: { statusCode?: number } } | undefined)?.output
    ?.statusCode;
}

function toSessionStatus() {
  if (connectorState.status === "connected" || connectorState.status === "qr") {
    return connectorState.status;
  }

  return "disconnected";
}

function resolveQrWaiters(qr: string) {
  for (const waiter of qrWaiters) {
    clearTimeout(waiter.timeout);
    waiter.resolve(qr);
  }

  qrWaiters.clear();
}

function rejectQrWaiters(error: Error) {
  for (const waiter of qrWaiters) {
    clearTimeout(waiter.timeout);
    waiter.reject(error);
  }

  qrWaiters.clear();
}

async function hasAuthSession() {
  try {
    const entries = await fs.readdir(getAuthInfoPath());
    return entries.length > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function clearAuthSession() {
  const authInfoPath = path.resolve(getAuthInfoPath());
  await fs.mkdir(authInfoPath, { recursive: true });

  const entries = await fs.readdir(authInfoPath);
  await Promise.all(
    entries.map((entry) =>
      fs.rm(path.join(authInfoPath, entry), {
        force: true,
        recursive: true
      })
    )
  );
}

function waitForQr(timeoutMs = 45000) {
  if (connectorState.status === "qr" && connectorState.qr) {
    return Promise.resolve(connectorState.qr);
  }

  return new Promise<string>((resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        qrWaiters.delete(waiter);
        reject(new Error("Timed out waiting for WhatsApp QR."));
      }, timeoutMs)
    };

    qrWaiters.add(waiter);
  });
}

function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  connectorState.status = "reconnecting";
  connectorState.reconnectAttempts += 1;

  const delayMs = getReconnectDelayMs(connectorState.reconnectAttempts);

  logger.warn(
    { delayMs, reconnectAttempts: connectorState.reconnectAttempts },
    "WhatsApp reconnect scheduled"
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    void startSocket(true).catch((error: unknown) => {
      connectorState.status = "error";
      connectorState.lastError =
        error instanceof Error ? error.stack ?? error.message : String(error);
      logger.error({ error }, "WhatsApp reconnect failed");
      scheduleReconnect();
    });
  }, delayMs);
}

async function connectSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(getAuthInfoPath());
  const { version } = await fetchLatestBaileysVersion();
  let hasConnected = false;

  const nextSocket = makeWASocket({
    auth: state,
    browser: [clientName, "Chrome", "1.0.0"],
    logger: logger.child({ module: "baileys" }) as never,
    printQRInTerminal: true,
    version
  });

  socket = nextSocket;

  nextSocket.ev.on("creds.update", saveCreds);

  nextSocket.ev.on("connection.update", (update) => {
    if (update.qr) {
      const hadQr = Boolean(connectorState.qr);
      connectorState.status = "qr";
      connectorState.qr = update.qr;
      resolveQrWaiters(update.qr);
      logger.info(hadQr ? "QR refreshed" : "QR generated");
    }

    if (update.connection === "open") {
      hasConnected = true;
      connectorState.status = "connected";
      connectorState.qr = null;
      connectorState.lastError = undefined;
      connectorState.lastConnectedAt = new Date().toISOString();
      connectorState.reconnectAttempts = 0;
      connectorState.phoneNumber = nextSocket.user?.id
        ?.split(":")[0]
        ?.replace(/\D/g, "");

      logger.info(
        { phoneNumber: connectorState.phoneNumber },
        "Connected"
      );
    }

    if (update.connection === "close") {
      const statusCode = getDisconnectStatusCode(update.lastDisconnect?.error);
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      const qrExpired = !hasConnected && Boolean(connectorState.qr);

      connectorState.status = "disconnected";
      if (qrExpired) {
        connectorState.qr = null;
        logger.info("QR expired");
      }
      connectorState.lastDisconnectedAt = new Date().toISOString();
      connectorState.lastError =
        update.lastDisconnect?.error instanceof Error
          ? update.lastDisconnect.error.stack ??
            update.lastDisconnect.error.message
          : update.lastDisconnect?.error
            ? String(update.lastDisconnect.error)
            : undefined;
      socket = null;

      logger.warn(
        { shouldReconnect, statusCode },
        "WhatsApp connection closed"
      );

      if (shouldReconnect && !suppressReconnect) {
        scheduleReconnect();
      }
    }
  });

  return nextSocket;
}

export function getSocket() {
  return socket;
}

export function getStatus() {
  return {
    ...connectorState,
    hasSocket: Boolean(socket)
  };
}

export async function getSession() {
  return {
    ok: true,
    status: toSessionStatus(),
    hasSession: await hasAuthSession(),
    hasSocket: Boolean(socket),
    phone: connectorState.phoneNumber ?? null,
    clientName,
    startedAt: connectorState.startedAt,
    reconnectAttempts: connectorState.reconnectAttempts
  };
}

export function getQr() {
  return connectorState.qr ?? null;
}

export async function startSocket(force = false) {
  if (socket && !force) {
    return socket;
  }

  if (connecting && !force) {
    return connecting;
  }

  if (force) {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    try {
      (socket as { end?: (error?: Error) => void } | null)?.end?.();
    } catch (error) {
      logger.warn({ error }, "Failed to close existing socket");
    }

    socket = null;
  }

  connectorState.status = "connecting";
  connecting = connectSocket().finally(() => {
    connecting = null;
  });

  return connecting;
}

export async function reconnectSocket() {
  return startSocket(true);
}

export async function logoutSession() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  suppressReconnect = true;

  try {
    if (socket) {
      try {
        await socket.logout("Session reset requested.");
      } catch (error) {
        logger.warn({ error }, "Failed to logout WhatsApp socket cleanly");
        socket.end(new Error("Session reset requested."));
      }
    }

    socket = null;
    connecting = null;
    connectorState.status = "disconnected";
    connectorState.qr = null;
    connectorState.phoneNumber = undefined;
    connectorState.lastConnectedAt = undefined;
    connectorState.lastDisconnectedAt = new Date().toISOString();
    connectorState.lastError = undefined;
    connectorState.reconnectAttempts = 0;
    rejectQrWaiters(new Error("Session reset requested."));

    await clearAuthSession();
  } finally {
    suppressReconnect = false;
  }

  await startSocket(true);
  await waitForQr();
}
