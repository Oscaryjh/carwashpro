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
  status: ConnectorStatusValue;
  hasSession: boolean;
  hasSocket: boolean;
  phone: string | null;
  clientName: string;
  startedAt: string;
  reconnectAttempts: number;
};

export type ConnectorStatusValue =
  | "starting"
  | "connecting"
  | "qr"
  | "connected"
  | "session_expired"
  | "disconnected"
  | "reconnecting"
  | "error";

export type ConnectorStatus = {
  status: ConnectorStatusValue;
  phoneNumber: string | null;
  lastSeen: string | null;
  hasSocket: boolean;
  reconnectAttempts: number;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  lastAckError: {
    code: string;
    messageId?: string;
    remoteJid?: string;
    at: string;
  } | null;
  sessionHealth: {
    ok: boolean;
    issue?: string;
    message?: string;
    detectedAt?: string;
  };
};

export type ConnectorDiagnostics = {
  whatsappNumber: string | null;
  connectionState: ConnectorStatusValue;
  linkedDeviceStatus: string;
  hasSocket: boolean;
  hasSession: boolean;
  lastSuccessfulSend: string | null;
  lastSuccessfulReceive: string | null;
  lastAckError: ConnectorStatus["lastAckError"];
  sessionHealth: ConnectorStatus["sessionHealth"];
  connectorVersion: string;
  baileysVersion: string;
  nodeVersion: string;
  startedAt: string;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  reconnectAttempts: number;
};

export type ConnectorJidLookup = {
  phone: string;
  fallbackJid: string;
  exists: boolean;
  jid: string | null;
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

export async function getConnectorStatus(businessId: string): Promise<ConnectorStatus> {
  const response = await fetchConnector("/status", businessId, {
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_STATUS_FAILED",
      getConnectorErrorMessage(body) || "Unable to read WhatsApp connector status.",
      response.status,
    );
  }

  const data =
    body && typeof body === "object" && "data" in body ? body.data : body;

  if (!data || typeof data !== "object" || !("status" in data)) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_STATUS_INVALID",
      "WhatsApp connector returned an invalid status response.",
      response.status,
    );
  }

  const statusData = data as Record<string, unknown>;

  return {
    status: readConnectorStatusValue(statusData),
    phoneNumber:
      readNullableString(statusData, "phoneNumber") ??
      readNullableString(statusData, "phone"),
    lastSeen:
      readNullableString(statusData, "lastSeen") ??
      readNullableString(statusData, "lastSeenAt") ??
      readNullableString(statusData, "startedAt") ??
      readNullableString(statusData, "lastDisconnectedAt"),
    hasSocket: readBoolean(statusData, "hasSocket"),
    reconnectAttempts: readNumber(statusData, "reconnectAttempts"),
    lastConnectedAt: readNullableString(statusData, "lastConnectedAt"),
    lastDisconnectedAt: readNullableString(statusData, "lastDisconnectedAt"),
    lastError: readNullableString(statusData, "lastError"),
    lastAckError: readLastAckError(statusData.lastAckError),
    sessionHealth: readSessionHealth(statusData.sessionHealth),
  };
}

export async function getConnectorDiagnostics(businessId: string): Promise<ConnectorDiagnostics> {
  const response = await fetchConnector("/diagnostics", businessId, {
    method: "GET",
    cache: "no-store",
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_DIAGNOSTICS_FAILED",
      getConnectorErrorMessage(body) || "Unable to read WhatsApp diagnostics.",
      response.status,
    );
  }

  const data =
    body && typeof body === "object" && "data" in body ? body.data : body;

  if (!data || typeof data !== "object") {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_DIAGNOSTICS_INVALID",
      "WhatsApp connector returned an invalid diagnostics response.",
      response.status,
    );
  }

  const diagnostics = data as Record<string, unknown>;

  return {
    whatsappNumber: readNullableString(diagnostics, "whatsappNumber"),
    connectionState: readConnectorStatusValue({
      status: diagnostics.connectionState,
    }),
    linkedDeviceStatus:
      readNullableString(diagnostics, "linkedDeviceStatus") ?? "unknown",
    hasSocket: readBoolean(diagnostics, "hasSocket"),
    hasSession: readBoolean(diagnostics, "hasSession"),
    lastSuccessfulSend: readNullableString(diagnostics, "lastSuccessfulSend"),
    lastSuccessfulReceive: readNullableString(
      diagnostics,
      "lastSuccessfulReceive",
    ),
    lastAckError: readLastAckError(diagnostics.lastAckError),
    sessionHealth: readSessionHealth(diagnostics.sessionHealth),
    connectorVersion:
      readNullableString(diagnostics, "connectorVersion") ?? "unknown",
    baileysVersion:
      readNullableString(diagnostics, "baileysVersion") ?? "unknown",
    nodeVersion: readNullableString(diagnostics, "nodeVersion") ?? "unknown",
    startedAt: readNullableString(diagnostics, "startedAt") ?? "",
    lastConnectedAt: readNullableString(diagnostics, "lastConnectedAt"),
    lastDisconnectedAt: readNullableString(diagnostics, "lastDisconnectedAt"),
    reconnectAttempts: readNumber(diagnostics, "reconnectAttempts"),
  };
}

export async function getConnectorSession(businessId: string) {
  const response = await fetchConnector("/session", businessId, {
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

export async function getConnectorJidLookup(
  businessId: string,
  phone: string,
): Promise<ConnectorJidLookup> {
  const params = new URLSearchParams({ businessId, phone });
  const response = await fetch(`${getWhatsAppConnectorUrl()}/jid?${params}`, {
    method: "GET",
    headers: getConnectorHeaders(),
    cache: "no-store",
  });
  const body = await readJson(response);

  if (!response.ok) {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_JID_LOOKUP_FAILED",
      getConnectorErrorMessage(body) || "Unable to verify WhatsApp JID.",
      response.status,
    );
  }

  const data =
    body && typeof body === "object" && "data" in body ? body.data : body;

  if (!data || typeof data !== "object") {
    throw new WhatsAppConnectorError(
      "WHATSAPP_CONNECTOR_JID_LOOKUP_INVALID",
      "WhatsApp connector returned an invalid JID lookup response.",
      response.status,
    );
  }

  const lookup = data as Record<string, unknown>;

  return {
    phone: readNullableString(lookup, "phone") ?? phone,
    fallbackJid: readNullableString(lookup, "fallbackJid") ?? "",
    exists: readBoolean(lookup, "exists"),
    jid: readNullableString(lookup, "jid"),
  };
}

export async function reconnectConnectorSession(businessId: string) {
  const response = await fetchConnector("/reconnect", businessId, {
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

export async function logoutConnectorSession(businessId: string) {
  const response = await fetchConnector("/logout", businessId, {
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
  businessId: string;
  phone: string;
  message: string;
}) {
  const response = await fetch(`${getWhatsAppConnectorUrl()}/send`, {
    method: "POST",
    headers: getConnectorHeaders(true),
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

export function getConnectorQrProxyPath() {
  return "/api/whatsapp/connector/qr";
}

async function fetchConnector(
  pathname: string,
  businessId: string,
  init: RequestInit,
) {
  const url = new URL(`${getWhatsAppConnectorUrl()}${pathname}`);
  url.searchParams.set("businessId", businessId);

  return fetch(url, {
    ...init,
    headers: {
      ...getConnectorHeaders(init.method === "POST"),
      ...(init.headers ?? {}),
    },
    ...(init.method === "POST" ? { body: JSON.stringify({ businessId }) } : {}),
  });
}

function getConnectorHeaders(includeJson = false) {
  const headers: Record<string, string> = {};
  const secret = process.env.WHATSAPP_CONNECTOR_API_SECRET?.trim();

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  if (secret) {
    headers["x-connector-api-secret"] = secret;
  }

  return headers;
}

function readConnectorStatusValue(
  data: Record<string, unknown>,
): ConnectorStatus["status"] {
  const value = readNullableString(data, "status");

  if (
    value === "starting" ||
    value === "connecting" ||
    value === "qr" ||
    value === "connected" ||
    value === "session_expired" ||
    value === "disconnected" ||
    value === "reconnecting" ||
    value === "error"
  ) {
    return value;
  }

  return "disconnected";
}

function readSessionHealth(value: unknown): ConnectorStatus["sessionHealth"] {
  if (!value || typeof value !== "object") {
    return { ok: true };
  }

  const health = value as Record<string, unknown>;

  return {
    ok: health.ok !== false,
    issue: typeof health.issue === "string" ? health.issue : undefined,
    message: typeof health.message === "string" ? health.message : undefined,
    detectedAt:
      typeof health.detectedAt === "string" ? health.detectedAt : undefined,
  };
}

function readLastAckError(value: unknown): ConnectorStatus["lastAckError"] {
  if (!value || typeof value !== "object") {
    return null;
  }

  const ackError = value as Record<string, unknown>;
  const code = typeof ackError.code === "string" ? ackError.code : null;
  const at = typeof ackError.at === "string" ? ackError.at : null;

  if (!code || !at) {
    return null;
  }

  return {
    code,
    at,
    messageId:
      typeof ackError.messageId === "string" ? ackError.messageId : undefined,
    remoteJid:
      typeof ackError.remoteJid === "string" ? ackError.remoteJid : undefined,
  };
}

function readNullableString(data: Record<string, unknown>, key: string) {
  if (!(key in data)) {
    return null;
  }

  const value = data[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function readBoolean(data: Record<string, unknown>, key: string) {
  if (!(key in data)) {
    return false;
  }

  return data[key] === true;
}

function readNumber(data: Record<string, unknown>, key: string) {
  if (!(key in data)) {
    return 0;
  }

  const value = data[key];
  return typeof value === "number" ? value : 0;
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
