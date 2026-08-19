"use client";

import { useEffect } from "react";
import {
  formatMalaysiaDateInput,
  normalizeMalaysiaDateInput,
  parseMalaysiaDateInput,
} from "@/lib/malaysia-date-input";
import styles from "./malaysia-date-controls.module.css";

type EnhancedDateInput = {
  cleanup: () => void;
  display: HTMLInputElement;
  sync: () => void;
};

export function MalaysiaDateControls() {
  useEffect(() => {
    const enhanced = new Map<HTMLInputElement, EnhancedDateInput>();

    function enhance(input: HTMLInputElement) {
      if (enhanced.has(input) || input.dataset.malaysiaDateEnhanced === "true")
        return;

      const display = document.createElement("input");
      const originalId = input.id;
      const originalRequired = input.required;
      const originalTabIndex = input.tabIndex;
      display.type = "text";
      display.inputMode = "numeric";
      display.placeholder = "DD/MM/YYYY";
      display.pattern = "[0-9]{2}/[0-9]{2}/[0-9]{4}";
      display.autocomplete = "off";
      display.className = `${input.className} ${styles.displayInput}`.trim();
      display.disabled = input.disabled;
      display.required = input.required;
      display.readOnly = input.readOnly;
      display.value = formatMalaysiaDateInput(input.value);
      display.setAttribute(
        "aria-label",
        input.getAttribute("aria-label") ?? "Date (DD/MM/YYYY)",
      );
      if (originalId) {
        display.id = originalId;
        input.id = `${originalId}--iso`;
      }

      input.required = false;
      input.tabIndex = -1;
      input.dataset.malaysiaDateEnhanced = "true";
      input.classList.add(styles.nativeInput);
      input.insertAdjacentElement("beforebegin", display);

      function validate() {
        const parsed = parseMalaysiaDateInput(display.value);
        const complete = display.value.length === 10;
        const outsideMinimum = parsed && input.min ? parsed < input.min : false;
        const outsideMaximum = parsed && input.max ? parsed > input.max : false;
        display.setCustomValidity(
          complete && !parsed
            ? "Enter a valid date in DD/MM/YYYY format."
            : outsideMinimum
              ? `Choose ${formatMalaysiaDateInput(input.min)} or later.`
              : outsideMaximum
                ? `Choose ${formatMalaysiaDateInput(input.max)} or earlier.`
                : "",
        );
        return parsed;
      }

      function setCanonicalValue(nextValue: string) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }

      display.addEventListener("input", () => {
        display.value = normalizeMalaysiaDateInput(display.value);
        const parsed = validate();
        setCanonicalValue(parsed ?? "");
      });
      display.addEventListener("blur", validate);
      display.addEventListener("pointerdown", (event) => {
        if (
          display.readOnly ||
          display.disabled ||
          event.offsetX < display.clientWidth - 50
        )
          return;
        event.preventDefault();
        input.showPicker?.();
      });

      const sync = () => {
        if (!display.isConnected || !input.isConnected) return;
        if (input.required) {
          display.required = true;
          input.required = false;
        }
        display.disabled = input.disabled;
        display.readOnly = input.readOnly;
        if (document.activeElement !== display)
          display.value = formatMalaysiaDateInput(input.value);
      };
      input.addEventListener("input", sync);
      input.addEventListener("change", sync);
      const redirectFocus = () => display.focus();
      input.addEventListener("focus", redirectFocus);
      const cleanup = () => {
        input.removeEventListener("input", sync);
        input.removeEventListener("change", sync);
        input.removeEventListener("focus", redirectFocus);
        display.remove();
        input.id = originalId;
        input.required = originalRequired;
        input.dataset.malaysiaDateEnhanced = "false";
        input.classList.remove(styles.nativeInput);
        input.tabIndex = originalTabIndex;
      };
      enhanced.set(input, {
        cleanup,
        display,
        sync,
      });
    }

    function enhanceAll(root: ParentNode = document) {
      if (
        root instanceof HTMLInputElement &&
        root.matches(
          'input[type="date"]:not([data-malaysia-date-enhanced="true"])',
        )
      )
        enhance(root);
      root
        .querySelectorAll<HTMLInputElement>(
          'input[type="date"]:not([data-malaysia-date-enhanced="true"])',
        )
        .forEach(enhance);
    }

    let observer: MutationObserver | null = null;
    let syncTimer: number | null = null;
    let firstFrame: number | null = null;
    let secondFrame: number | null = null;
    let hydrationDelay: number | null = null;
    let cancelled = false;

    function startEnhancing() {
      if (cancelled || observer) return;
      enhanceAll();
      observer = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes)
            if (node instanceof Element) enhanceAll(node);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      syncTimer = window.setInterval(() => {
        for (const [input, record] of enhanced) {
          if (!input.isConnected || !record.display.isConnected) {
            record.cleanup();
            enhanced.delete(input);
          } else record.sync();
        }
      }, 250);
    }

    function startAfterHydration() {
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          hydrationDelay = window.setTimeout(startEnhancing, 750);
        });
      });
    }

    if (document.readyState === "complete") startAfterHydration();
    else window.addEventListener("load", startAfterHydration, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", startAfterHydration);
      if (firstFrame !== null) window.cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame);
      if (hydrationDelay !== null) window.clearTimeout(hydrationDelay);
      observer?.disconnect();
      if (syncTimer !== null) window.clearInterval(syncTimer);
      for (const record of enhanced.values()) record.cleanup();
      enhanced.clear();
    };
  }, []);

  return null;
}
