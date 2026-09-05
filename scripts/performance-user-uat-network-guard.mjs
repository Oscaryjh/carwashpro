// Isolated UAT process only; no production code/config changes.
import net from 'node:net';
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = args[0];
  const options = typeof value === 'object' ? (Array.isArray(value) ? value[0] : value) : null;
  const host = options?.host ?? options?.hostname ?? (typeof args[1] === 'string' ? args[1] : 'localhost');
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) throw new Error('UAT_EXTERNAL_NETWORK_BLOCKED');
  return original.apply(this, args);
};
const fetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const raw = typeof input === 'string' || input instanceof URL ? input : input.url;
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(raw).hostname)) return Promise.reject(new Error('UAT_EXTERNAL_NETWORK_BLOCKED'));
  return fetch(input, init);
};
