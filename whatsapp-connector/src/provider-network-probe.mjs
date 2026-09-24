// Test-only preload: count any outbound network attempt made by the connector child.
import net from "node:net";
import tls from "node:tls";

let outboundNetworkCalls = 0;
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  outboundNetworkCalls += 1;
  return originalConnect.apply(this, args);
};
const originalTlsConnect = tls.connect;
tls.connect = function (...args) {
  outboundNetworkCalls += 1;
  return originalTlsConnect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = function (...args) {
  outboundNetworkCalls += 1;
  return originalFetch.apply(this, args);
};

process.on("message", (message) => {
  if (message === "provider-network-snapshot") {
    process.send?.({ type: "provider-network-snapshot", outboundNetworkCalls });
  }
});
