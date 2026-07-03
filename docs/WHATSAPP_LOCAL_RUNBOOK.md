# WhatsApp Local Runbook

This guide explains how to run WashFlow locally with the database, Next.js app, and WhatsApp worker as separate processes.

## 1. Start DB

Open a PowerShell window in the project folder:

```powershell
cd "C:\Users\oscar\Documents\Car wash CRM Pos"
npm.cmd run db:start
```

Keep this window running.

The local database should listen on:

```text
localhost:5432
```

If the app shows `Can't reach database server at localhost:5432`, start this command first, then refresh the page.

## 2. Start Next

Open a second PowerShell window:

```powershell
cd "C:\Users\oscar\Documents\Car wash CRM Pos"
npm.cmd run dev
```

This command starts only the Next.js app.

Open:

```text
http://127.0.0.1:3000
```

## 3. Start WhatsApp Worker

Open a third PowerShell window:

```powershell
cd "C:\Users\oscar\Documents\Car wash CRM Pos"
npm.cmd run whatsapp:worker
```

This worker is separate from Next.js. If the worker crashes, the main app should still stay open.

## 4. Confirm Baileys Is Connected

Go to:

```text
http://127.0.0.1:3000/whatsapp/settings
```

Use one of these connection methods:

- Generate QR, then scan with WhatsApp Linked Devices.
- Use phone pairing code, then enter the code in WhatsApp.

After login, the settings page should show:

```text
connected
```

The connected WhatsApp number should also appear on the page.

## 5. Test Sending WhatsApp

After the worker is connected:

1. Go to WhatsApp Inbox:

```text
http://127.0.0.1:3000/whatsapp/inbox
```

2. Select a chat.
3. Type a message.
4. Click Send, or press Enter.

For API testing, send a POST request to:

```text
POST /api/whatsapp/send
```

Body:

```json
{
  "phone": "601112212259",
  "message": "WashFlow test message"
}
```

The phone number is normalized to:

```text
60xxxxxxxxx@s.whatsapp.net
```

On success, the API returns a WhatsApp `messageId`.

## 6. Common Issues

### Port Already In Use

If port `3000` is already used, Next.js may fail to start.

Check the process using the port:

```powershell
Get-NetTCPConnection -LocalPort 3000 -State Listen
```

If port `5432` is already used, the embedded database may fail to start.

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen
```

### auth_info Session

Baileys stores the local WhatsApp session in:

```text
C:\Users\oscar\Documents\Car wash CRM Pos\auth_info
```

If WhatsApp cannot reconnect or QR pairing behaves strangely, disconnect from WhatsApp settings first. Only clear `auth_info` when you intentionally want to reset the WhatsApp login session.

### --use-system-ca

The WhatsApp worker must run with:

```text
--use-system-ca
```

This is already included in:

```powershell
npm.cmd run whatsapp:worker
```

Do not start the worker with plain `node` unless `--use-system-ca` is included.

### Worker Crash Does Not Affect Next

The WhatsApp worker is separate from the Next.js dev server.

If WhatsApp stops working but the app still opens:

1. Keep DB and Next running.
2. Restart only:

```powershell
npm.cmd run whatsapp:worker
```

If Next.js crashes, restart only:

```powershell
npm.cmd run dev
```

If the database stops, restart only:

```powershell
npm.cmd run db:start
```

### Recommended Local Startup Order

Use three separate PowerShell windows:

```text
1. npm.cmd run db:start
2. npm.cmd run dev
3. npm.cmd run whatsapp:worker
```

This keeps the system easier to debug because database, web app, and WhatsApp connector are no longer tied to one process.
