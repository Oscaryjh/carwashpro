// Shared by the TypeScript monitor and the standalone backup alert transport.
export function readAlertBearer(env = process.env) {
  const token = env.OPS_ALERT_WEBHOOK_BEARER_TOKEN;
  if (!token) {
    if (env.APP_DEPLOYMENT_PROFILE?.trim() === "rc-staging" || env.RAILWAY_ENVIRONMENT_NAME?.trim() === "Production-RC-Staging-20260920") throw new Error("ALERT_BEARER_TOKEN_REQUIRED");
    return null;
  }
  if (!/^[A-Za-z0-9._~+/-]{32,512}={0,2}$/.test(token)) throw new Error("ALERT_BEARER_TOKEN_INVALID");
  return token;
}

export function assertAlertDestination(destination, token, allowLocal = false) {
  let url;
  let decoded;
  try { url = new URL(destination); decoded = decodeURIComponent(url.toString()); }
  catch { throw new Error("ALERT_DESTINATION_INVALID"); }
  const local = allowLocal && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && !token && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash ||
      (token && (redactAlertBearer(destination, { OPS_ALERT_WEBHOOK_BEARER_TOKEN: token }) !== destination || decoded.includes(token)))) {
    throw new Error("ALERT_DESTINATION_INVALID");
  }
}

export function redactAlertBearer(value, env = process.env) {
  let text = String(value ?? "");
  const token = env.OPS_ALERT_WEBHOOK_BEARER_TOKEN;
  if (token) {
    for (const form of new Set([token, encodeURIComponent(token), JSON.stringify(token).slice(1, -1)])) {
      text = text.split(form).join("[REDACTED]");
    }
    // Match raw/mixed/all-percent representations, including nested %25 escapes.
    // Case-insensitivity applies only to hex digits, never the token itself.
    const pattern = [...token].map(char => {
      const literal = char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const hex = char.charCodeAt(0).toString(16).padStart(2, "0").replace(/[a-f]/g, digit => `[${digit}${digit.toUpperCase()}]`);
      return `(?:${literal}|%(?:25)*${hex})`;
    }).join("");
    text = text.replace(new RegExp(pattern, "g"), "[REDACTED]");
  }
  return text.replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}

export function serializeAlertPayload(event) {
  try { return redactAlertBearer(JSON.stringify(event)); }
  catch { throw new Error("ALERT_PAYLOAD_INVALID"); }
}
