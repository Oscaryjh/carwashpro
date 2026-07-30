import type { ReactNode } from "react";
import "@/app/group-command.css";

type GroupPageHeroProps = {
  action?: ReactNode;
  description: ReactNode;
  eyebrow?: string;
  meta: string[];
  title: string;
  variant: "overview" | "reports" | "closing";
};

export function GroupPageHero({
  action,
  description,
  eyebrow = "Business Group",
  meta,
  title,
  variant,
}: GroupPageHeroProps) {
  return (
    <header className={`group-page-hero group-page-hero--${variant}`}>
      <div className="group-page-hero-main">
        <div className="group-page-hero-kicker">
          <span aria-hidden="true" className="group-page-hero-icon">
            <HeroIcon variant={variant} />
          </span>
          <p>{eyebrow}</p>
        </div>
        <h1>{title}</h1>
        <p className="group-page-hero-description">{description}</p>
        <div className="group-page-hero-meta" aria-label="Page context">
          {meta.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </div>
      {action ? <div className="group-page-hero-action">{action}</div> : null}
    </header>
  );
}

function HeroIcon({
  variant,
}: {
  variant: GroupPageHeroProps["variant"];
}) {
  if (variant === "reports") {
    return (
      <svg fill="none" viewBox="0 0 24 24">
        <path d="M5 20V9M12 20V4M19 20v-7" />
        <path d="M3 20h18" />
      </svg>
    );
  }

  if (variant === "closing") {
    return (
      <svg fill="none" viewBox="0 0 24 24">
        <path d="M7 3h10l3 3v15H4V3h3Z" />
        <path d="m8 13 2.5 2.5L16 10M8 7h8" />
      </svg>
    );
  }

  return (
    <svg fill="none" viewBox="0 0 24 24">
      <path d="M4 20V7l4-3 4 3v13M12 20V9l4-3 4 3v11" />
      <path d="M2 20h20M7 10h2M7 14h2M15 11h2M15 15h2" />
    </svg>
  );
}
