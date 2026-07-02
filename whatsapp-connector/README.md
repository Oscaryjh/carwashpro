# WashFlow WhatsApp Connector

Standalone WhatsApp connector for WashFlow demos and local integrations.

This service uses Node.js, TypeScript, and Baileys. It does not depend on Next.js, Prisma, WashFlow app code, CRM, POS, or any `src/` files from the main project.

## Install

```powershell
npm install
```

## Environment

Copy `.env.example` to `.env` and adjust if needed.

```env
PORT=8787
AUTH_INFO_PATH=./auth_info
LOG_LEVEL=info

CONNECTOR_URL=http://127.0.0.1:8787
TEST_PHONE=601112212259
TEST_MESSAGE=WashFlow connector test message
```

## Run In Development

```powershell
npm run dev
```

The dev command starts the HTTP server with:

```powershell
node --use-system-ca --import tsx src/server.ts
```

`--use-system-ca` is important on Windows because WhatsApp Web/Baileys can fail TLS validation when Node does not use the system certificate store.

## Build

```powershell
npm run build
```

## Start Production Build

```powershell
npm start
```

## API

All endpoints return JSON.

### GET /health

Checks that the HTTP service is alive.

```powershell
curl http://localhost:8787/health
```

### GET /status

Returns the current Baileys socket state.

```powershell
curl http://localhost:8787/status
```

Example response:

```json
{
  "ok": true,
  "data": {
    "status": "connected",
    "startedAt": "2026-07-02T00:00:00.000Z",
    "phoneNumber": "601112212259",
    "reconnectAttempts": 0,
    "hasSocket": true
  }
}
```

### GET /qr

Returns the latest WhatsApp QR string when the socket is waiting for QR pairing.

```powershell
curl http://localhost:8787/qr
```

Connected response:

```json
{
  "ok": true,
  "status": "connected",
  "qr": null
}
```

QR response:

```json
{
  "ok": true,
  "status": "qr",
  "qr": "<qr string>"
}
```

No QR response:

```json
{
  "ok": false,
  "status": "connecting",
  "error": "QR not available"
}
```

## QR Connection Flow

1. Start the connector with `npm run dev`.
2. Open `GET /status`.
3. If the status is `qr`, open `GET /qr`.
4. Render the returned `qr` string as a QR code in the UI or a local testing tool.
5. Open WhatsApp on the shop phone, go to Linked devices, and scan the QR.
6. Call `GET /status` again. A successful login returns `connected`.
7. If the QR expires, call `POST /reconnect`, then call `GET /qr` again.

### POST /send

Sends a WhatsApp text message. The connector must already be paired and
`GET /status` must return `connected`.

Body:

```json
{
  "phone": "601112212259",
  "message": "Hello from connector"
}
```

The connector strips formatting characters such as `+`, spaces, hyphens, and
parentheses before converting the phone number into a WhatsApp JID:

```text
601112212259@s.whatsapp.net
```

Success response:

```json
{
  "ok": true,
  "data": {
    "messageId": "...",
    "to": "601112212259@s.whatsapp.net"
  }
}
```

If WhatsApp is not connected, `/send` returns HTTP `409`:

```json
{
  "ok": false,
  "error": {
    "code": "WHATSAPP_NOT_CONNECTED",
    "message": "WhatsApp is not connected. Check /status or reconnect."
  }
}
```

If Baileys fails while sending, `/send` returns HTTP `500`:

```json
{
  "ok": false,
  "error": {
    "code": "WHATSAPP_SEND_FAILED",
    "message": "..."
  }
}
```

curl:

```cmd
curl -X POST http://127.0.0.1:8787/send ^
  -H "Content-Type: application/json" ^
  -d "{\"phone\":\"601112212259\",\"message\":\"Hello from WhatsApp Connector V2\"}"
```

## Local Send Test

Use this after the connector is already paired and connected to WhatsApp.

1. Copy `.env.example` to `.env`.
2. Set `CONNECTOR_URL`, `TEST_PHONE`, and `TEST_MESSAGE`.
3. Start the connector in one terminal:

```powershell
npm run dev
```

4. Run the test script in another terminal:

```powershell
node scripts/test-send.mjs
```

The script calls:

- `GET /status`
- `POST /send`

It stops before sending if `/status` is not `connected`. If `/send` succeeds,
the response includes the WhatsApp `messageId` and destination JID.

### POST /reconnect

Forces the connector to rebuild the Baileys socket.

```powershell
curl -X POST http://localhost:8787/reconnect
```

## Directory Structure

```text
whatsapp-connector/
  package.json        npm scripts and dependencies
  tsconfig.json       TypeScript compiler config
  .env.example        local configuration example
  README.md           this guide
  auth_info/          Baileys multi-file auth session
  src/
    server.ts         HTTP API server
    socket.ts         single Baileys socket instance
    sender.ts         sendTextMessage helper
    reconnect.ts      reconnect backoff helper
    logger.ts         pino logger
    types.ts          shared TypeScript types
```

## Notes

- Keep only one connector process running per `auth_info` session.
- If WhatsApp logs out, delete or archive `auth_info/` and connect again.
- This connector intentionally does not import or call WashFlow business code.
