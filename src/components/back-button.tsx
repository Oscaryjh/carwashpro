"use client";

import { useRouter } from "next/navigation";

type BackButtonProps = {
  fallbackHref: string;
  className?: string;
  children?: string;
};

export function BackButton({
  fallbackHref,
  className = "secondary-link-button",
  children = "Back",
}: BackButtonProps) {
  const router = useRouter();

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    window.location.assign(fallbackHref);
  }

  return (
    <button type="button" className={className} onClick={handleBack}>
      {children}
    </button>
  );
}
