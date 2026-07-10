import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  getBinaryNodeChild,
  getBinaryNodeChildren,
  type WASocket
} from "@whiskeysockets/baileys";
import ffmpeg from "@ffmpeg-installer/ffmpeg";
import {
  resolveIssuanceJid,
  resolveTcTokenJid,
  storeTcTokensFromIqResult
} from "@whiskeysockets/baileys/lib/Utils/tc-token-utils.js";

import { getStatus, recordSuccessfulSend, startSocket } from "./socket.js";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export class WhatsAppNotConnectedError extends Error {
  code = "WHATSAPP_NOT_CONNECTED";

  constructor() {
    super("WhatsApp is not connected. Check /status or reconnect.");
  }
}

export class WhatsAppSendFailedError extends Error {
  code = "WHATSAPP_SEND_FAILED";

  constructor(message: string) {
    super(message);
  }
}

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  if (!digits) {
    throw new Error("phone is required.");
  }

  let normalizedPhone = digits;

  if (normalizedPhone.startsWith("0")) {
    normalizedPhone = `60${normalizedPhone.slice(1)}`;
  } else if (!normalizedPhone.startsWith("60")) {
    normalizedPhone = `60${normalizedPhone}`;
  }

  return normalizedPhone;
}

export function normalizePhoneToJid(phone: string) {
  return `${normalizePhone(phone)}@s.whatsapp.net`;
}

type SendTextMessageOptions = {
  audioBase64?: string | null;
  audioMimeType?: string | null;
  audioFileName?: string | null;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  imageFileName?: string | null;
  documentBase64?: string | null;
  documentMimeType?: string | null;
  documentFileName?: string | null;
};

function isDirectJid(value: string) {
  return value.endsWith("@s.whatsapp.net") || value.endsWith("@lid");
}

function getLookupLid(recipient: unknown) {
  const lid = (recipient as { lid?: unknown } | null)?.lid;

  return typeof lid === "string" && lid.endsWith("@lid") ? lid : null;
}

async function ensureTrustedContactToken(socket: WASocket, jid: string) {
  const lidMapping = socket.signalRepository?.lidMapping;
  const getLIDForPN = lidMapping.getLIDForPN.bind(lidMapping);
  const getPNForLID = lidMapping.getPNForLID.bind(lidMapping);
  const storageJid = await resolveTcTokenJid(jid, getLIDForPN);
  const tokenData = await socket.authState.keys.get("tctoken", [storageJid]);
  const existingToken = tokenData?.[storageJid]?.token;

  if (existingToken?.length) {
    logger.info(
      { jid, storageJid, tokenLength: existingToken.length },
      "WhatsApp trusted contact token already available"
    );
    return;
  }

  try {
    const contactName = jid.replace(/@s\.whatsapp\.net$/i, "");
    await socket.addOrEditContact(jid, {
      firstName: contactName,
      fullName: contactName,
      pnJid: jid,
      lidJid: storageJid.endsWith("@lid") ? storageJid : undefined,
      saveOnPrimaryAddressbook: true
    });
    logger.info(
      { jid, storageJid, contactName },
      "WhatsApp contact synced before trusted token issue"
    );
  } catch (error) {
    logger.warn(
      {
        error: error instanceof Error ? error.stack ?? error.message : error,
        jid,
        storageJid
      },
      "Failed to sync WhatsApp contact before trusted token issue"
    );
  }

  const issueJid = await resolveIssuanceJid(
    jid,
    socket.serverProps.lidTrustedTokenIssueToLid,
    getLIDForPN,
    getPNForLID
  );
  const issueJids = Array.from(new Set([issueJid, storageJid]));

  for (const candidateJid of issueJids) {
    const result = await socket.issuePrivacyTokens([candidateJid]);
    const tokensNode = getBinaryNodeChild(result, "tokens");
    const tokenNodes = tokensNode
      ? getBinaryNodeChildren(tokensNode, "token")
      : [];

    logger.info(
      {
        jid,
        candidateJid,
        storageJid,
        tokenNodeCount: tokenNodes.length,
        tokenTypes: tokenNodes.map((node) => node.attrs.type),
        tokenJids: tokenNodes.map((node) => node.attrs.jid)
      },
      "WhatsApp trusted contact token issue result"
    );

    await storeTcTokensFromIqResult({
      result,
      fallbackJid: jid,
      keys: socket.authState.keys,
      getLIDForPN
    });
  }

  const updatedTokenData = await socket.authState.keys.get("tctoken", [
    storageJid
  ]);
  const updatedToken = updatedTokenData?.[storageJid]?.token;

  logger.info(
    {
      jid,
      issueJid,
      storageJid,
      tokenStored: Boolean(updatedToken?.length),
      tokenLength: updatedToken?.length ?? 0
    },
    "WhatsApp trusted contact token prepared"
  );
}

export async function validateWhatsAppRecipient(phone: string) {
  const normalizedPhone = normalizePhone(phone);
  const fallbackJid = `${normalizedPhone}@s.whatsapp.net`;
  const socket = await startSocket();
  const status = getStatus();

  if (status.status !== "connected") {
    throw new WhatsAppNotConnectedError();
  }

  const lookupResult = await socket.onWhatsApp(fallbackJid);
  const recipient = lookupResult?.[0] ?? null;

  logger.info(
    {
      phone: normalizedPhone,
      fallbackJid,
      lookup: recipient
    },
    "WhatsApp recipient validation"
  );

  return {
    phone: normalizedPhone,
    fallbackJid,
    exists: Boolean(recipient?.exists),
    jid: recipient?.jid ?? null
  };
}

async function buildMessageContent(
  message: string,
  options: SendTextMessageOptions = {}
) {
  if (options.audioBase64) {
    const audio = await prepareWhatsAppVoiceAudio(
      options.audioBase64,
      options.audioMimeType
    );

    return {
      audio: audio.buffer,
      mimetype: audio.mimeType,
      ptt: true
    };
  }

  if (options.imageBase64) {
    const caption = message === "Image" ? "" : message;

    return {
      image: Buffer.from(options.imageBase64, "base64"),
      mimetype: options.imageMimeType ?? "image/jpeg",
      ...(caption ? { caption } : {})
    };
  }

  if (!options.documentBase64) {
    return { text: message };
  }

  return {
    document: Buffer.from(options.documentBase64, "base64"),
    mimetype: options.documentMimeType ?? "application/octet-stream",
    fileName: options.documentFileName ?? "document",
    caption: message
  };
}

export async function sendTextMessage(
  phone: string,
  message: string,
  options: SendTextMessageOptions = {}
) {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    throw new Error("message is required.");
  }

  const recipientInput = phone.trim();
  const socket = await startSocket();
  const status = getStatus();

  if (status.status !== "connected") {
    throw new WhatsAppNotConnectedError();
  }

  if (isDirectJid(recipientInput)) {
    try {
      const result = await socket.sendMessage(
        recipientInput,
        await buildMessageContent(trimmedMessage, options)
      );
      logger.info(
        {
          to: recipientInput,
          hasAudio: Boolean(options.audioBase64),
          hasImage: Boolean(options.imageBase64),
          hasDocument: Boolean(options.documentBase64),
          messageId: result?.key?.id,
          remoteJid: result?.key?.remoteJid,
          fromMe: result?.key?.fromMe
        },
        "WhatsApp direct JID send accepted"
      );
      recordSuccessfulSend();

      return {
        messageId: result?.key?.id ?? null,
        to: recipientInput
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to send WhatsApp message.";
      throw new WhatsAppSendFailedError(errorMessage);
    }
  }

  const normalizedPhone = normalizePhone(recipientInput);
  const fallbackJid = `${normalizedPhone}@s.whatsapp.net`;

  try {
    const lookupResult = await socket.onWhatsApp(fallbackJid);
    const recipient = lookupResult?.[0];
    logger.info(
      {
        phone: normalizedPhone,
        fallbackJid,
        lookup: recipient
      },
      "WhatsApp recipient lookup"
    );

    if (!recipient?.exists || !recipient.jid) {
      throw new Error(
        `Recipient ${normalizedPhone} could not be verified on WhatsApp.`
      );
    }

    const recipientLid = getLookupLid(recipient);
    const whatsappJid = recipientLid ?? recipient.jid;

    try {
      await ensureTrustedContactToken(socket, recipient.jid);
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.stack ?? error.message : error,
          jid: recipient.jid
        },
        "Failed to prepare WhatsApp trusted contact token"
      );
    }

    const result = await socket.sendMessage(
      whatsappJid,
      await buildMessageContent(trimmedMessage, options)
    );
    logger.info(
      {
        to: whatsappJid,
        phoneJid: recipient.jid,
        lidJid: recipientLid,
        hasDocument: Boolean(options.documentBase64),
        hasAudio: Boolean(options.audioBase64),
        hasImage: Boolean(options.imageBase64),
        messageId: result?.key?.id,
        remoteJid: result?.key?.remoteJid,
        fromMe: result?.key?.fromMe
      },
      "WhatsApp send accepted"
    );
    recordSuccessfulSend();

    return {
      messageId: result?.key?.id ?? null,
      to: whatsappJid
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to send WhatsApp message.";
    throw new WhatsAppSendFailedError(message);
  }
}

async function prepareWhatsAppVoiceAudio(
  audioBase64: string,
  mimeType: string | null | undefined
) {
  const sourceBuffer = Buffer.from(audioBase64, "base64");
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";

  if (normalizedMimeType.includes("ogg")) {
    return {
      buffer: sourceBuffer,
      mimeType: "audio/ogg; codecs=opus"
    };
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "washflow-wa-audio-"));
  const inputPath = path.join(tempDir, `input-${randomUUID()}${getAudioInputExtension(mimeType)}`);
  const outputPath = path.join(tempDir, `voice-${randomUUID()}.ogg`);

  try {
    await fs.writeFile(inputPath, sourceBuffer);
    await execFileAsync(
      ffmpeg.path,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-acodec",
        "libopus",
        "-b:a",
        "32k",
        "-ar",
        "48000",
        "-ac",
        "1",
        outputPath
      ],
      { maxBuffer: 1024 * 1024 }
    );

    const outputBuffer = await fs.readFile(outputPath);
    logger.info(
      {
        sourceMimeType: mimeType,
        sourceBytes: sourceBuffer.length,
        outputBytes: outputBuffer.length,
        ffmpegVersion: ffmpeg.version
      },
      "WhatsApp voice audio converted to ogg opus"
    );

    return {
      buffer: outputBuffer,
      mimeType: "audio/ogg; codecs=opus"
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function getAudioInputExtension(mimeType: string | null | undefined) {
  const normalizedMimeType = mimeType?.toLowerCase() ?? "";

  if (normalizedMimeType.includes("webm")) {
    return ".webm";
  }

  if (normalizedMimeType.includes("ogg")) {
    return ".ogg";
  }

  if (normalizedMimeType.includes("mpeg") || normalizedMimeType.includes("mp3")) {
    return ".mp3";
  }

  if (normalizedMimeType.includes("mp4")) {
    return ".mp4";
  }

  return ".audio";
}
