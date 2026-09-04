"use client";

import { useState, type ReactNode } from "react";

/** Keep broken uploads from replacing the employee/store identity with a browser error icon. */
export function StaffImage({ src, alt, fallback, width, height, onUnavailable }: {
  src: string | null | undefined;
  alt: string;
  fallback: ReactNode;
  width?: number;
  height?: number;
  onUnavailable?: () => void;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!src || failedSource === src) return <>{fallback}</>;
  function unavailable() {
    setFailedSource(src!);
    onUnavailable?.();
  }
  return (
    // Uploads are already resized and served with immutable versioned URLs.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      alt={alt}
      src={src}
      width={width}
      height={height}
      onError={unavailable}
      ref={(node) => {
        // A cached 404 may complete before React attaches its error listener.
        if (node?.complete && node.naturalWidth === 0) unavailable();
      }}
    />
  );
}
