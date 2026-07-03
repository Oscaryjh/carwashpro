type ConnectorSendSuccess = {
  ok: true;
  data: {
    messageId: string | null;
    to: string;
  };
};

type ConnectorSendFailure = {
  ok: false;
  error:
    | string
    | {
        code?: string;
        message?: string;
      };
};

type ConnectorSendResponse = ConnectorSendSuccess | ConnectorSendFailure;

type ConnectorSessionResponse = {
  ok: true;
  status: "connected" | "qr" | "disconnected";
  hasSession: boolean;
  hasSocket: boolean;
  phone: string | null;
  clientName: string;
  startedAt: string;
  reconnectAttempts: number;
};

export class WhatsAppConnectorError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function getWhatsAppConnectorUrl() {
  const connectorUrl = process.env.WHATSAPP_CONNECTOR_URL?.trim();

  if (!connectorUrl) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_URL_MISSING",
      "WHATSAPP_CONNECTOR_URL is not configured.",
      500,
    );
  }

  return connectorUrl.replace(/\/+$/, "");
}

export async function getConnectorSession() {
  const response = await fetch(`${getWhatsAppConnectorUrl()}/session`, {
    method: "GET",
    cache: "no-store",
  });
  const body = (await readJson(response)) as ConnectorSessionResponse;

  if (!response.ok || !body?.ok) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_SESSION_FAILED",
      getConnectorErrorMessage(body) || "Unable to read WhatsApp connector session.",
      response.status,
    );
  }

  return body;
}

export async function reconnectConnectorSession() {
  const response = await fetch(`${getWhatsAppConnectorUrl()}/reconnect`, {
    method: "POST",
    cache: "no-store",
  });
  const body = await readJson(response);

  if (!response.ok || body?.ok !== true) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_RECONNECT_FAILED",
      getConnectorErrorMessage(body) || "Unable to reconnect WhatsApp connector.",
      response.status,
    );
  }
}

export async function logoutConnectorSession() {
  const response = await fetch(`${getWhatsAppConnectorUrl()}/logout`, {
    method: "POST",
    cache: "no-store",
  });
  const body = await readJson(response);

  if (!response.ok || body?.ok !== true) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_LOGOUT_FAILED",
      getConnectorErrorMessage(body) || "Unable to logout WhatsApp connector.",
      response.status,
    );
  }
}

export async function sendConnectorTextMessage(input: {
  phone: string;
  message: string;
}) {
  const response = await fetch(`${getWhatsAppConnectorUrl()}/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
    cache: "no-store",
  });
  const body = (await readJson(response)) as ConnectorSendResponse;

  if (!response.ok || !body?.ok) {
    throw new WhatsAppConnectorError(
      getConnectorErrorCode(body),
      getConnectorErrorMessage(body) || "Unable to send WhatsApp message.",
      response.status,
    );
  }

  return body.data;
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: text };
  }
}

function getConnectorErrorCode(body: unknown) {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error &&
    "code" in body.error &&
    typeof body.error.code === "string"
  ) {
    return body.error.code;
  }

  return "WHATSAPP_CONNECTOR_SEND_FAILED";
}

function getConnectorErrorMessage(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return "";
  }

  if (typeof body.error === "string") {
    return body.error;
  }

  if (
    body.error &&
    typeof body.error === "object" &&
    "message" in body.error &&
    typeof body.error.message === "string"
  ) {
    return body.error.message;
  }

  return "";
}
