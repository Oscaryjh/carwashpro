"use client";

import type { MouseEvent } from "react";

export function EmployeeProfileProtectedSubmit({
  children,
}: {
  children: string;
}) {
  function confirmProtectedClear(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.form;
    const clearsProtectedValue = Boolean(
      form?.querySelector<HTMLInputElement>(
        'input[name^="clear"]:checked',
      ),
    );
    if (
      clearsProtectedValue &&
      !window.confirm(
        "Clear the selected protected values from the current employee profile? Historical payroll, audit records, and retained artifacts will remain unchanged.",
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <button onClick={confirmProtectedClear} type="submit">
      {children}
    </button>
  );
}
