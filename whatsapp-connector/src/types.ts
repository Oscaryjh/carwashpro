export type ConnectorStatus =
  | "starting"
  | "connecting"
  | "qr"
  | "connected"
  | "session_expired"
  | "disconnected"
  | "reconnecting"
  | "error";

export type SessionHealthIssue =
  | "ACK_463"
  | "CONNECTION_LOST"
  | "LOGGED_OUT"
  | "SESSION_INVALID";

export type ConnectorState = {
  status: ConnectorStatus;
  startedAt: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  phoneNumber?: string;
  qr?: string | null;
  lastError?: string;
  lastAckError?: {
    code: string;
    messageId?: string;
    remoteJid?: string;
    at: string;
  };
  lastSuccessfulSendAt?: string;
  lastSuccessfulReceiveAt?: string;
  sessionHealth?: {
    ok: boolean;
    issue?: SessionHealthIssue;
    message?: string;
    detectedAt?: string;
  };
  reconnectAttempts: number;
};

export type SendRequestBody = {
  businessId?: unknown;
  requestId?: unknown;
  audioBase64?: unknown;
  audioMimeType?: unknown;
  audioFileName?: unknown;
  imageBase64?: unknown;
  imageMimeType?: unknown;
  imageFileName?: unknown;
  phone?: unknown;
  message?: unknown;
  documentBase64?: unknown;
  documentMimeType?: unknown;
  documentFileName?: unknown;
};

export type ApiError =
  | string
  | {
      code: string;
      message: string;
    };

export type ApiResponse<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: ApiError;
    };
