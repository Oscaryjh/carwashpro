import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

const loopback = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export function assertRcNetworkHost(host) {
  if (!loopback.has(String(host ?? "localhost").toLowerCase())) throw new Error("RC_EXTERNAL_NETWORK_DENIED");
}

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const target = normalized[0];
  if (typeof target === "object" && target !== null) {
    if (target.path) throw new Error("RC_EXTERNAL_NETWORK_DENIED");
    assertRcNetworkHost(target.host ?? target.hostname);
  } else if (typeof target === "number") {
    assertRcNetworkHost(typeof normalized[1] === "string" ? normalized[1] : "localhost");
  } else throw new Error("RC_EXTERNAL_NETWORK_DENIED");
  return connect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assertRcNetworkHost(url.hostname);
  return originalFetch(input, init);
};
syncBuiltinESMExports();
