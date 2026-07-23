import { formatDateValue } from "@/lib/business-time";
import type { ClosingWhatsAppLanguage } from "./types";

export function resolveClosingWhatsAppLanguage(
  language: ClosingWhatsAppLanguage,
) {
  return language === "ZH" ? "ZH" : "EN";
}

export function buildUnclosedClosingReminderText(input: {
  branchName: string;
  businessDate: string;
  businessName: string;
  deadlineTime: string;
  language: ClosingWhatsAppLanguage;
}) {
  const dateLabel = formatDateValue(input.businessDate, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  if (resolveClosingWhatsAppLanguage(input.language) === "ZH") {
    return [
      `每日关账提醒`,
      `${input.businessName} - ${input.branchName}`,
      `营业日：${dateLabel}`,
      `截止时间：${input.deadlineTime}`,
      `该分店还没有完成正式关账。请在系统完成关账后，老板才会收到冻结后的日报。`,
    ].join("\n");
  }

  return [
    `Daily closing reminder`,
    `${input.businessName} - ${input.branchName}`,
    `Business date: ${dateLabel}`,
    `Deadline: ${input.deadlineTime}`,
    `This branch has not completed formal closing yet. The owner report will only be sent after the closing snapshot is frozen.`,
  ].join("\n");
}
