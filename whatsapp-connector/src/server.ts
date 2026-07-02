import "dotenv/config";

import http from "node:http";
import { URL } from "node:url";

import { logger } from "./logger.js";
import {
  sendTextMessage,
  WhatsAppNotConnectedError,
  WhatsAppSendFailedError
} from "./sender.js";
import {
  getQr,
  getSession,
  getStatus,
  logoutSession,
  reconnectSocket,
  startSocket
} from "./socket.js";
import type { ApiResponse, SendRequestBody } from "./types.js";

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

    request.on("data", (chunk: Buffer) => {
      rawBody += chunk.toString("utf8");

      if (rawBody.length > 1024 * 1024) {
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

      void lazyStartSocket();

    sendJson(response, 200, {
      ok: true,
      data: {
        service: "whatsapp-connector",
        uptimeSeconds: Math.round(process.uptime())
      }
    });
    return;
  }

    if (url.pathname === "/status") {
      if (request.method !== "GET") {
        methodNotAllowed(response);
        return;
      }

    sendJson(response, 200, {
      ok: true,
      data: getStatus()
    });
      return;
    }

    if (url.pathname === "/session") {
      if (request.method !== "GET") {
        methodNotAllowed(response);
        return;
      }

      sendRawJson(response, 200, await getSession());
      return;
    }

    if (request.method === "GET" && url.pathname === "/qr/image") {
      const QRCode = await import("qrcode");

      const status = getStatus().status;
      const qr = getQr();

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

      const qr = getQr();
      const status = getStatus().status;

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
      await reconnectSocket();
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
    sendRawJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/logout") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    await logoutSession();
    sendRawJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === "/send") {
    if (request.method !== "POST") {
      methodNotAllowed(response);
      return;
    }

    const body = (await readJsonBody(request)) as SendRequestBody;
    const validationError = validateSendRequestBody(body);

    if (validationError) {
      sendJson(response, 400, {
        ok: false,
        error: validationError
      });
      return;
    }

    try {
      const result = await sendTextMessage(body.phone as string, body.message as string);

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

let socketStartPromise: Promise<unknown> | null = null;

function lazyStartSocket() {
  if (!socketStartPromise) {
    socketStartPromise = startSocket().catch((error: unknown) => {
      logger.error({ error }, "Failed to start WhatsApp socket");
      socketStartPromise = null;
    });
  }

  return socketStartPromise;
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
  console.error("[uncaughtException]", err);
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

process.on("beforeExit", (code) => {
  console.log("[beforeExit]", code);
});

process.on("exit", (code) => {
  console.log("[exit]", code);
});
