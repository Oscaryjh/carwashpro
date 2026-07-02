export type ConnectorStatus =
  | "starting"
  | "connecting"
  | "qr"
  | "connected"
  | "disconnected"
  | "reconnecting"
  | "error";

export type ConnectorState = {
  status: ConnectorStatus;
  startedAt: string;
  lastConnectedAt?: string;
  lastDisconnectedAt?: string;
  phoneNumber?: string;
  qr?: string | null;
  lastError?: string;
  reconnectAttempts: number;
};

export type SendRequestBody = {
  phone?: unknown;
  message?: unknown;
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
