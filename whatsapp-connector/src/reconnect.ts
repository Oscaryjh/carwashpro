export function getReconnectDelayMs(attempt: number) {
  const cappedAttempt = Math.min(Math.max(attempt, 0), 5);
  const exponentialDelay = 1000 * 2 ** cappedAttempt;
  const jitter = Math.floor(Math.random() * 500);

  return Math.min(exponentialDelay + jitter, 30000);
}
