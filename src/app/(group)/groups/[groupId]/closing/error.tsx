"use client";

import { useEffect } from "react";

export default function GroupClosingError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[group-closing-page] Unable to render Closing Audit.", error);
  }, [error]);

  return (
    <div className="content group-closing-page">
      <section className="group-report-state" role="alert">
        <h1>Closing Audit is unavailable</h1>
        <p>
          No partial audit result is shown. Retry the authorized report load.
        </p>
        <button type="button" onClick={reset}>
          Retry
        </button>
      </section>
    </div>
  );
}
