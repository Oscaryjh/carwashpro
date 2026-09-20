export function readAlertBearer(env?: Readonly<Record<string, string | undefined>>): string | null;
export function assertAlertDestination(destination: string, token: string | null, allowLocal?: boolean): void;
export function redactAlertBearer(value: unknown, env?: Readonly<Record<string, string | undefined>>): string;
export function serializeAlertPayload(event: unknown): string;
