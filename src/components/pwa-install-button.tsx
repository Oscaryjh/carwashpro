"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (standalone) {
      return;
    }

    function handleInstallPrompt(event: Event) {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    }

    function handleInstalled() {
      setInstallPrompt(null);
    }

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  if (!installPrompt) {
    return null;
  }

  async function installApp() {
    const prompt = installPrompt;
    if (!prompt) {
      return;
    }

    await prompt.prompt();
    await prompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <button className="pwa-install-button" onClick={installApp} type="button">
      <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
        <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
        <path d="M5 17v3h14v-3" />
      </svg>
      <span>Install app</span>
    </button>
  );
}
