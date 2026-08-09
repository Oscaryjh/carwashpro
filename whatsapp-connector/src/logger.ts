import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    censor: "[REDACTED]",
    paths: [
      "authInfoPath",
      "attrs",
      "body",
      "candidateJid",
      "contactName",
      "error",
      "errorMessage",
      "fallbackJid",
      "from",
      "issueJid",
      "jid",
      "lidJid",
      "lookup",
      "mediaBase64",
      "message",
      "phone",
      "phoneJid",
      "phoneNumber",
      "pushName",
      "rawMessageJson",
      "remoteJid",
      "storageJid",
      "to",
      "tokenJids",
      "update",
      "*.body",
      "*.error",
      "*.phone",
      "*.remoteJid"
    ]
  }
});
