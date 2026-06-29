"use client";

import type { InputHTMLAttributes } from "react";

type UppercaseInputProps = InputHTMLAttributes<HTMLInputElement>;

export function UppercaseInput({
  defaultValue,
  onInput,
  className,
  ...props
}: UppercaseInputProps) {
  return (
    <input
      {...props}
      className={["uppercase-input", className].filter(Boolean).join(" ")}
      defaultValue={
        typeof defaultValue === "string" ? defaultValue.toUpperCase() : defaultValue
      }
      onInput={(event) => {
        event.currentTarget.value = event.currentTarget.value.toUpperCase();
        onInput?.(event);
      }}
    />
  );
}
