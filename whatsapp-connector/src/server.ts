import "dotenv/config";

import http from "node:http";
import { URL } from "node:url";

import { logger } from "./logger.js";
import {
  sendTextMessage,
  validateWhatsAppRecipient,
  WhatsAppNotConnectedError,
  WhatsAppSendFailedError
} from "./sender.js";
import {
  getDiagnostics,
  getActiveSessionCount,
  getQr,
  getSession,
  getStatus,
  logoutSession,
  reconnectSocket,
  startSocket
} from "./socket.js";
import type { ApiResponse, SendRequestBody } from "./types.js";

const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;

function getPort() {
  const port = Number(process.env.PORT);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT is required and must be a positive number.");
  }

  return port;
}

function assertRequiredEnv() {
  if (!process.env.AUTH_INFO_PATH) {
    throw new Error("AUTH_INFO_PATH is required.");
  }
}

function getDefaultBusinessId() {
  return (
    process.env.WHATSAPP_DEFAULT_BUSINESS_ID?.trim() ||
    process.env.WHATSAPP_INCOMING_BUSINESS_ID?.trim() ||
    ""
  );
}

function resolveBusinessId(url: URL, body?: SendRequestBody) {
  const value =
    url.searchParams.get("businessId")?.trim() ||
    (typeof body?.businessId === "string" ? body.businessId.trim() : "") ||
    getDefaultBusinessId();

  if (!value) {
    throw new HttpRequestError(400, "businessId is required.");
  }

  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) {
    throw new HttpRequestError(400, "businessId is invalid.");
  }

  return value;
}

class HttpRequestError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

function assertConnectorAccess(request: http.IncomingMessage) {
  const secret = process.env.CONNECTOR_API_SECRET?.trim();

  if (secret && request.headers["x-connector-api-secret"] !== secret) {
    throw new HttpRequestError(401, "Connector API authentication failed.");
  }
}

function sendJson<T>(
  response: http.ServerResponse,
  statusCode: number,
  body: ApiResponse<T>
) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function sendRawJson(
  response: http.ServerResponse,
  statusCode: number,
  body: Record<string, unknown>
) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function readJsonBody(request: http.IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let rawBody = "";
    let bodyBytes = 0;

    request.on("data", (chunk: Buffer) => {
      bodyBytes += chunk.length;
      rawBody += chunk.toString("utf8");

      if (bodyBytes > MAX_JSON_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });

    request.on("end", () => {
      if (!rawBody.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function methodNotAllowed(response: http.ServerResponse) {
  sendJson(response, 405, {
    ok: false,
    error: "Method not allowed."
  });
}

function errorStatusCode(error: unknown) {
  if (error instanceof HttpRequestError) {
    return error.statusCode;
  }

  return error instanceof WhatsAppNotConnectedError ? 409 : 500;
}

function serializeError(error: unknown) {
  if (error instanceof WhatsAppNotConnectedError) {
    return {
      code: error.code,
      message: error.message
    };
  }

  return error instanceof Error ? error.message : "Internal server error.";
}

function validateSendRequestBody(body: SendRequestBody) {
  if (typeof body.phone !== "string" || !body.phone.trim()) {
    return "phone is required.";
  }

  if (!body.phone.replace(/\D/g, "")) {
    return "phone is required.";
  }

  if (typeof body.message !== "string") {
    return "message is required.";
  }

  if (!body.message.trim()) {
    return "message must not be empty.";
  }

  if (
    body.documentBase64 !== undefined &&
    (typeof body.documentBase64 !== "string" || !body.documentBase64.trim())
  ) {
    return "documentBase64 must be a non-empty string.";
  }

  if (
    body.documentMimeType !== undefined &&
    typeof body.documentMimeType !== "string"
  ) {
    return "documentMimeType must be a string.";
  }

  if (
    body.documentFileName !== undefined &&
    typeof body.documentFileName !== "string"
  ) {
    return "documentFileName must be a string.";
  }

  if (
    body.audioBase64 !== undefined &&
    (typeof body.audioBase64 !== "string" || !body.audioBase64.trim())
  ) {
    return "audioBase64 must be a non-empty string.";
  }

  if (
    body.audioMimeType !== undefined &&
    typeof body.audioMimeType !== "string"
  ) {
    return "audioMimeType must be a string.";
  }

  if (
    body.audioFileName !== undefined &&
    typeof body.audioFileName !== "string"
  ) {
    return "audioFileName must be a string.";
  }

  if (
    body.imageBase64 !== undefined &&
    (typeof body.imageBase64 !== "string" || !body.imageBase64.trim())
  ) {
    return "imageBase64 must be a non-empty string.";
  }

  if (
    body.imageMimeType !== undefined &&
    typeof body.imageMimeType !== "string"
  ) {
    return "imageMimeType must be a string.";
  }

  if (
    body.imageFileName !== undefined &&
    typeof body.imageFileName !== "string"
  ) {
    return "imageFileName must be a string.";
  }

  return null;
}

async function handleRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse
) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    sendJson(response, 200, {
      ok: true,
      data: {
        service: "whatsapp-connector",
        uptimeSeconds: Math.round(process.uptime()),
        activeSessions: getActiveSessionCount()
      }
    });
    return;
  }

  assertConnectorAccess(request);

  let body: SendRequestBody | undefined;
  if (request.method === "POST") {
    body = (await readJsonBody(request)) as SendRequestBody;
  }
  const businessId = resolveBusinessId(url, body);

    if (url.pathname === "/status") {
      if (request.method !== "GET") {
        methodNotAllowed(response);
        return;
      }

    void lazyStartSocket(businessId);

    sendJson(response, 200, {
      ok: true,
      data: getStatus(businessId)
    });
      return;
    }

    if (url.pathname === "/session") {
      if (request.method !== "GET") {
        methodNotAllowed(response);
        return;
      }

      void lazyStartSocket(businessId);

      sendRawJson(response, 200, await getSession(businessId));
      return;
    }

    if (url.pathname === "/diagnostics") {
      if (request.method !== "GET") {
        methodNotAllowed(response);
        return;
      }

      void lazyStartSocket(businessId);

      sendRawJson(response, 200, await getDiagnostics(businessId));
      return;
    }

    if (request.method === "GET" && url.pathname === "/qr/image") {
      const QRCode = await import("qrcode");

      void lazyStartSocket(businessId);
      const status = getStatus(businessId).status;
      const qr = getQr(businessId);

      if (status !== "qr" || !qr) {
        sendRawJson(response, 404, { ok: false, error: "QR not available" });
        return;
      }

      const png = await QRCode.toBuffer(qr, {
        type: "png",
        width: 320,
        margin: 2
      });

      response.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": png.length
      });
      response.end(png);
      return;
    }

    if (url.pathname === "/qr") {
      if (request.method !== "GET") {
        methodNotAllowed(response);
        return;
      }

      void lazyStartSocket(businessId);
      const qr = getQr(businessId);
      const status = getStatus(businessId).status;

      if (status === "connected") {
        sendRawJson(response, 200, {
          ok: true,
          status: "connected",
          qr: null,
        });
        return;
      }

      if (qr) {
        sendRawJson(response, 200, {
          ok: true,
          status: "qr",
          qr,
        });
        return;
      }

      sendRawJson(response, 404, {
        ok: false,
        status,
        error: "QR not available",
      });
      return;
    }

    if (url.pathname === "/reconnect") {
      if (request.method !== "POST") {
        methodNotAllowed(response);
        return;
    }

    try {
      const status = await reconnectSocket(businessId);
      sendRawJson(response, 200, {
        ok: true,
        data: status
      });
      return;
    } catch (error: unknown) {
      logger.error({ error }, "Failed to reconnect WhatsApp socket");
      sendJson(response, 503, {
        ok: false,
        error: {
          code: "WHATSAPP_RECONNECT_FAILED",
          message: "WhatsApp reconnect failed. HTTP server is still running."
        }
      });
      return;
    }
  }

    if (url.pathname === "/logout") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    await logoutSession(businessId);
    sendRawJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/jid") {
    if (request.method !== "GET") {
      methodNotAllowed(response);
      return;
    }

    const phone = url.searchParams.get("phone");

    if (!phone) {
      sendJson(response, 400, {
        ok: false,
        error: "phone is required."
      });
      return;
    }

    const result = await validateWhatsAppRecipient(businessId, phone);
    sendJson(response, 200, {
      ok: true,
      data: result
    });
    return;
  }

  if (url.pathname === "/send") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    body ??= {};
    const validationError = validateSendRequestBody(body);

    if (validationError) {
      sendJson(response, 400, {
        ok: false,
        error: validationError
      });
      return;
    }

    try {
      const result = await sendTextMessage(
        businessId,
        body.phone as string,
        body.message as string,
        {
          audioBase64: body.audioBase64 as string | undefined,
          audioMimeType: body.audioMimeType as string | undefined,
          audioFileName: body.audioFileName as string | undefined,
          imageBase64: body.imageBase64 as string | undefined,
          imageMimeType: body.imageMimeType as string | undefined,
          imageFileName: body.imageFileName as string | undefined,
          documentBase64: body.documentBase64 as string | undefined,
          documentMimeType: body.documentMimeType as string | undefined,
          documentFileName: body.documentFileName as string | undefined
        }
      );

      sendJson(response, 200, {
        ok: true,
        data: result
      });
    } catch (error) {
      if (error instanceof WhatsAppNotConnectedError) {
        sendJson(response, 409, {
          ok: false,
          error: {
            code: error.code,
            message: error.message
          }
        });
        return;
      }

      if (error instanceof WhatsAppSendFailedError) {
        sendJson(response, 500, {
          ok: false,
          error: {
            code: error.code,
            message: error.message
          }
        });
        return;
      }

      const message =
        error instanceof Error ? error.message : "Failed to send WhatsApp message.";
      logger.error({ error }, "Failed to send WhatsApp message");
      sendJson(response, 500, {
        ok: false,
        error: {
          code: "WHATSAPP_SEND_FAILED",
          message
        }
      });
    }
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: "Not found."
  });
}

assertRequiredEnv();

const server = http.createServer((request, response) => {
  void handleRequest(request, response).catch((error: unknown) => {
    logger.error({ error }, "HTTP request failed");
    sendJson(response, errorStatusCode(error), {
      ok: false,
      error: serializeError(error)
    });
  });
});

const port = getPort();

const socketStartPromises = new Map<string, Promise<unknown>>();

logger.info(
  {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  },
  "Runtime diagnostics enabled"
);

function lazyStartSocket(businessId: string) {
  let promise = socketStartPromises.get(businessId);

  if (!promise) {
    promise = startSocket(businessId).catch((error: unknown) => {
      logger.error({ error, businessId }, "Failed to start WhatsApp socket");
      socketStartPromises.delete(businessId);
    });
    socketStartPromises.set(businessId, promise);
  }

  return promise;
}

server.listen(port, () => {
  logger.info({ port }, "WhatsApp Connector HTTP server listening");
});

process.on("SIGINT", () => {
  logger.info("SIGINT received. Closing HTTP server.");
  server.close(() => process.exit(0));
});

process.on("SIGTERM", () => {
  logger.info("SIGTERM received. Closing HTTP server.");
  server.close(() => process.exit(0));
});
process.on("uncaughtException", (err) => {
  console.error("[runtime:uncaughtException]", err);
  logger.error({ error: err }, "Runtime uncaughtException");
});

process.on("unhandledRejection", (err) => {
  console.error("[runtime:unhandledRejection]", err);
  logger.error({ error: err }, "Runtime unhandledRejection");
});

process.on("beforeExit", (code) => {
  console.log("[runtime:beforeExit]", code);
  logger.warn({ code }, "Runtime beforeExit");
});

process.on("exit", (code) => {
  console.log("[runtime:exit]", code);
});
