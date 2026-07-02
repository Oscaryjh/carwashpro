import "dotenv/config";

const connectorUrl = (process.env.CONNECTOR_URL || "").replace(/\/+$/, "");
const testPhone = process.env.TEST_PHONE;
const testMessage = process.env.TEST_MESSAGE;

if (!connectorUrl || !testPhone || !testMessage) {
  console.error("Missing test config. Set CONNECTOR_URL, TEST_PHONE, and TEST_MESSAGE in .env.");
  process.exit(1);
}

async function readJson(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function requestJson(path, options) {
  const response = await fetch(`${connectorUrl}${path}`, options);
  const body = await readJson(response);

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

console.log(`Connector URL: ${connectorUrl}`);
console.log("");

console.log("GET /status");
const statusResult = await requestJson("/status");
console.log(JSON.stringify(statusResult, null, 2));
console.log("");

if (statusResult.body?.data?.status !== "connected") {
  console.error("WhatsApp is not connected. Scan the QR first, then rerun this script.");
  process.exit(1);
}

console.log("POST /send");
const sendResult = await requestJson("/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    phone: testPhone,
    message: testMessage,
  }),
});
console.log(JSON.stringify(sendResult, null, 2));

if (!sendResult.ok) {
  process.exitCode = 1;
}
