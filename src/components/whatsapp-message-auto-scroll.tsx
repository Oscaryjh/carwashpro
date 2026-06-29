"use client";

import { useEffect } from "react";

type WhatsAppMessageAutoScrollProps = {
  scrollKey: string;
};

export function WhatsAppMessageAutoScroll({
  scrollKey,
}: WhatsAppMessageAutoScrollProps) {
  useEffect(() => {
    const thread = document.querySelector<HTMLElement>(".whatsapp-message-thread");

    if (!thread) {
      return;
    }

    const messageThread = thread;

    function scrollToLatestMessage() {
      messageThread.scrollTop = messageThread.scrollHeight;
    }

    requestAnimationFrame(scrollToLatestMessage);
    const timeoutId = window.setTimeout(scrollToLatestMessage, 80);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [scrollKey]);

  return null;
}
