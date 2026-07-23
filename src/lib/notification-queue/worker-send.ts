export type WhatsAppSendMode = "mock" | "live";

export type QueueSendInput = {
  businessId: string;
  queueId: string;
  phone: string;
  message: string;
  documentBase64?: string | null;
  documentMimeType?: string | null;
  documentFileName?: string | null;
};

export type QueueSendResult = {
  connectorCallsEnabled: boolean;
  messageId: string;
  mode: WhatsAppSendMode;
  simulated: boolean;
};

export type QueueSendTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

type WhatsAppWorkerEnv = Record<string, string | undefined>;

type ConnectorSendResponse =
  | {
      ok: true;
      data: {
        messageId: string | null;
        to: string;
      };
    }
  | {
      ok: false;
      error:
        | string
        | {
            code?: string;
            message?: string;
          };
    };

export class WhatsAppSendModeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhatsAppSendModeConfigError";
  }
}

export class ConnectorSendError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorSendError";
  }
}

export function resolveWhatsAppSendMode(
  env: WhatsAppWorkerEnv = process.env,
) {
  const value = env.WHATSAPP_SEND_MODE?.trim();

  if (value === "mock" || value === "live") {
    return value;
  }

  throw new WhatsAppSendModeConfigError(
    'WHATSAPP_SEND_MODE must be explicitly set to "mock" or "live".',
  );
}

export function getWhatsAppSendModeRuntimeConfig(
  env: WhatsAppWorkerEnv = process.env,
) {
  const mode = resolveWhatsAppSendMode(env);

  return {
    connectorCallsEnabled: mode === "live",
    mode,
  };
}

export async function sendWhatsAppQueueItem(
  input: QueueSendInput,
  options: {
    env?: WhatsAppWorkerEnv;
    transport?: QueueSendTransport;
  } = {},
): Promise<QueueSendResult> {
  const env = options.env ?? process.env;
  const mode = resolveWhatsAppSendMode(env);

  if (mode === "mock") {
    return {
      connectorCallsEnabled: false,
      messageId: `mock:${input.queueId}`,
      mode,
      simulated: true,
    };
  }

  const result = await sendToConnector(input, {
    env,
    transport: options.transport ?? fetch,
  });

  return {
    connectorCallsEnabled: true,
    messageId: result.messageId,
    mode,
    simulated: false,
  };
}

export function isConnectorNotConnected(error: unknown) {
  return error instanceof ConnectorSendError && error.status === 409;
}

async function sendToConnector(
  input: QueueSendInput,
  options: {
    env: WhatsAppWorkerEnv;
    transport: QueueSendTransport;
  },
) {
  const isAudio = input.documentMimeType?.startsWith("audio/");
  const isImage = input.documentMimeType?.startsWith("image/");
  const response = await options.transport(
    `${getConnectorUrl(options.env)}/send`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(options.env.WHATSAPP_CONNECTOR_API_SECRET?.trim()
          ? {
              "x-connector-api-secret":
                options.env.WHATSAPP_CONNECTOR_API_SECRET.trim(),
            }
          : {}),
      },
      body: JSON.stringify({
        businessId: input.businessId,
        phone: input.phone,
        message: input.message,
        ...(input.documentBase64 && isAudio
          ? {
              audioBase64: input.documentBase64,
              audioMimeType: input.documentMimeType,
              audioFileName: input.documentFileName,
            }
          : input.documentBase64 && isImage
          ? {
              imageBase64: input.documentBase64,
              imageMimeType: input.documentMimeType,
              imageFileName: input.documentFileName,
            }
          : input.documentBase64
          ? {
              documentBase64: input.documentBase64,
              documentMimeType: input.documentMimeType,
              documentFileName: input.documentFileName,
            }
          : {}),
      }),
    },
  );
  const body = (await readJson(response)) as ConnectorSendResponse;

  if (!response.ok || !body?.ok) {
    throw new ConnectorSendError(
      response.status,
      getConnectorErrorMessage(body) || "WhatsApp connector send failed.",
    );
  }

  if (!body.data.messageId) {
    throw new Error("WhatsApp connector did not return a messageId.");
  }

  return {
    messageId: body.data.messageId,
  };
}

function getConnectorUrl(env: WhatsAppWorkerEnv) {
  const connectorUrl = env.WHATSAPP_CONNECTOR_URL?.trim();

  if (!connectorUrl) {
    throw new Error("WHATSAPP_CONNECTOR_URL is not configured.");
  }

  return connectorUrl.replace(/\/+$/, "");
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
