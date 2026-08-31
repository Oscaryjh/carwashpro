import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import styles from "./staff-home-v2.module.css";

export { styles as staffHomeV2Styles };

export function StaffV2PageHeader({
  leading,
  title,
  meta,
}: {
  leading?: ReactNode;
  title: string;
  meta?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      {leading ? <span className={styles.pageHeaderLeading}>{leading}</span> : null}
      <div className={styles.pageHeaderCopy}>
        <h1>{title}</h1>
        {meta ? <p>{meta}</p> : null}
      </div>
    </header>
  );
}

export function StaffV2StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = tone === "success"
    ? styles.badgeSuccess
    : tone === "warning"
      ? styles.badgeWarning
      : tone === "danger"
        ? styles.badgeDanger
        : "";
  return <span className={`${styles.badge} ${toneClass}`}>{children}</span>;
}

export function StaffV2HeroStatus({
  eyebrow,
  title,
  badge,
  children,
}: {
  eyebrow: string;
  title: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.hero} aria-labelledby="staff-home-attendance-title">
      <header className={styles.heroHeader}>
        <div>
          <p className={styles.heroEyebrow}>{eyebrow}</p>
          <h2 id="staff-home-attendance-title">{title}</h2>
        </div>
        {badge}
      </header>
      <div className={styles.heroBody}>{children}</div>
    </section>
  );
}

export type StaffV2SummaryItem = { label: string; value: ReactNode };

export function StaffV2CompactSummary({ items }: { items: StaffV2SummaryItem[] }) {
  if (!items.length) return null;
  return (
    <dl
      className={styles.summary}
      style={{ "--summary-columns": Math.min(items.length, 4) } as CSSProperties}
    >
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StaffV2ListRow({
  href,
  leading,
  kicker,
  title,
  meta,
  ariaLabel,
}: {
  href?: string;
  leading?: ReactNode;
  kicker?: string;
  title: ReactNode;
  meta?: ReactNode;
  ariaLabel?: string;
}) {
  const content = (
    <>
      {leading ? <span className={styles.rowLeading}>{leading}</span> : null}
      <span className={styles.rowCopy}>
        {kicker ? <small>{kicker}</small> : null}
        <strong>{title}</strong>
        {meta ? <span>{meta}</span> : null}
      </span>
      {href ? <i className={styles.rowTrailing} aria-hidden="true">›</i> : null}
    </>
  );
  if (href) {
    return <Link aria-label={ariaLabel} className={styles.listRow} href={href}>{content}</Link>;
  }
  return <div className={styles.listRow}>{content}</div>;
}

export function StaffV2ActionRow({
  href,
  leading,
  kicker,
  title,
  meta,
  count,
  ariaLabel,
}: {
  href: string;
  leading?: ReactNode;
  kicker?: string;
  title: ReactNode;
  meta?: ReactNode;
  count?: number;
  ariaLabel?: string;
}) {
  return (
    <Link aria-label={ariaLabel} className={styles.actionRow} href={href}>
      {leading ? <span className={styles.rowLeading}>{leading}</span> : null}
      <span className={styles.rowCopy}>
        {kicker ? <small>{kicker}</small> : null}
        <strong>{title}</strong>
        {meta ? <span>{meta}</span> : null}
      </span>
      <i className={styles.rowTrailing} aria-hidden="true">{count ?? "›"}</i>
    </Link>
  );
}

export function StaffV2EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyState} role="status">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
