"use client";

import {
  forwardRef,
  useEffect,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import styles from "@/components/money-numpad-input.module.css";

type MoneyNumpadInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "inputMode" | "onChange" | "readOnly" | "type" | "value"
> & {
  amountDue: number;
  amountLabel?: string;
  decimalPlaces?: number;
  dialogEyebrow?: string;
  dialogTitle?: string;
  exactLabel?: string;
  onValueChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  value: string;
};

export const MoneyNumpadInput = forwardRef<
  HTMLInputElement,
  MoneyNumpadInputProps
>(function MoneyNumpadInput(
  {
    amountDue,
    amountLabel = "Amount due",
    decimalPlaces = 2,
    dialogEyebrow = "CASH PAYMENT",
    dialogTitle = "Cash received",
    exactLabel = "Exact",
    onValueChange,
    placeholder,
    prefix = "RM",
    suffix = "",
    value,
    ...inputProps
  },
  ref,
) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => setIsMounted(true), []);

  useEffect(() => {
    if (!isOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  function appendValue(nextValue: string) {
    const current = value || "";

    if (nextValue === ".") {
      if (decimalPlaces === 0) return;
      if (current.includes(".")) return;
      onValueChange(current ? `${current}.` : "0.");
      return;
    }

    const decimal = current.split(".")[1];
    if (decimal?.length === decimalPlaces) return;

    if (current === "0" && nextValue !== "00") {
      onValueChange(nextValue);
      return;
    }

    if (!current && nextValue === "00") {
      onValueChange("0");
      return;
    }

    onValueChange(`${current}${nextValue}`);
  }

  const displayAmount = Number(value || 0);

  return (
    <>
      <input
        {...inputProps}
        aria-haspopup="dialog"
        inputMode="none"
        onClick={() => setIsOpen(true)}
        placeholder={placeholder}
        readOnly
        ref={ref}
        type="text"
        value={value}
      />
      {isMounted && isOpen
        ? createPortal(
            <div
              className={styles.backdrop}
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setIsOpen(false);
              }}
            >
              <section
                aria-label={`${dialogTitle} keypad`}
                aria-modal="true"
                className={styles.dialog}
                role="dialog"
              >
                <header className={styles.header}>
                  <div>
                    <span>{dialogEyebrow}</span>
                    <h2>{dialogTitle}</h2>
                  </div>
                  <button
                    aria-label={`Close ${dialogTitle.toLowerCase()} keypad`}
                    className={styles.close}
                    onClick={() => setIsOpen(false)}
                    type="button"
                  >
                    &times;
                  </button>
                </header>

                <div className={styles.amountPanel}>
                  <span>{amountLabel}</span>
                  <strong>{prefix}{amountDue.toFixed(decimalPlaces)}{suffix}</strong>
                  <output aria-live="polite">
                    {prefix}{displayAmount.toFixed(decimalPlaces)}{suffix}
                  </output>
                </div>

                <div className={styles.keypad}>
                  {["1", "2", "3"].map((key) => (
                    <KeyButton key={key} onClick={() => appendValue(key)}>{key}</KeyButton>
                  ))}
                  <KeyButton label="Delete last digit" onClick={() => onValueChange(value.slice(0, -1))}>
                    Delete
                  </KeyButton>
                  {["4", "5", "6"].map((key) => (
                    <KeyButton key={key} onClick={() => appendValue(key)}>{key}</KeyButton>
                  ))}
                  <KeyButton onClick={() => onValueChange("")}>Clear</KeyButton>
                  {["7", "8", "9"].map((key) => (
                    <KeyButton key={key} onClick={() => appendValue(key)}>{key}</KeyButton>
                  ))}
                  <KeyButton
                    emphasis="soft"
                    onClick={() => onValueChange(amountDue.toFixed(decimalPlaces))}
                  >
                    {exactLabel}
                  </KeyButton>
                  <KeyButton onClick={() => appendValue("00")}>00</KeyButton>
                  <KeyButton onClick={() => appendValue("0")}>0</KeyButton>
                  <KeyButton onClick={() => appendValue(".")}>.</KeyButton>
                  <KeyButton emphasis="primary" onClick={() => setIsOpen(false)}>
                    Done
                  </KeyButton>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
});

function KeyButton({
  children,
  emphasis,
  label,
  onClick,
}: {
  children: ReactNode;
  emphasis?: "primary" | "soft";
  label?: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={
        emphasis === "primary"
          ? styles.primaryKey
          : emphasis === "soft"
            ? styles.softKey
            : undefined
      }
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
