import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import styles from "./staff-v2.module.css";

export { styles as staffV2Styles };

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
    <header className={`${styles.pageHeader} ${leading ? "" : styles.pageHeaderNoLeading}`}>
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
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass = tone === "success"
    ? styles.badgeSuccess
    : tone === "warning"
      ? styles.badgeWarning
      : tone === "danger"
        ? styles.badgeDanger
        : tone === "info"
          ? styles.badgeInfo
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
  trailing,
  ariaLabel,
}: {
  href?: string;
  leading?: ReactNode;
  kicker?: string;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
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
      {trailing ?? (href ? <i className={styles.rowTrailing} aria-hidden="true">›</i> : null)}
    </>
  );
  if (href) {
    return <Link aria-label={ariaLabel} className={styles.listRow} href={href} role="listitem">{content}</Link>;
  }
  return <div className={styles.listRow} role="listitem">{content}</div>;
}

export function StaffV2ActionRow({
  href,
  leading,
  kicker,
  title,
  meta,
  count,
  trailing,
  ariaLabel,
}: {
  href: string;
  leading?: ReactNode;
  kicker?: string;
  title: ReactNode;
  meta?: ReactNode;
  count?: number;
  trailing?: ReactNode;
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
      <i className={styles.rowTrailing} aria-hidden="true">{trailing ?? count ?? "›"}</i>
    </Link>
  );
}

export function StaffV2ButtonActionRow({
  leading,
  kicker,
  title,
  meta,
  trailing = "›",
  ariaLabel,
  disabled = false,
  tone = "default",
  onClick,
}: {
  leading?: ReactNode;
  kicker?: string;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`${styles.actionRow} ${styles.buttonActionRow} ${tone === "danger" ? styles.buttonActionRowDanger : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {leading ? <span className={styles.rowLeading}>{leading}</span> : null}
      <span className={styles.rowCopy}>
        {kicker ? <small>{kicker}</small> : null}
        <strong>{title}</strong>
        {meta ? <span>{meta}</span> : null}
      </span>
      <i className={styles.rowTrailing} aria-hidden="true">{trailing}</i>
    </button>
  );
}

export function StaffV2RowGroup({
  children,
  ariaLabel,
  className,
}: {
  children: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return <div aria-label={ariaLabel} className={`${styles.rowGroup} ${className ?? ""}`} role="list">{children}</div>;
}

export function StaffV2PeriodNavigator({
  ariaLabel = "Schedule period",
  label,
  previousHref,
  previousLabel,
  nextHref,
  nextLabel,
  todayHref,
  todayLabel,
}: {
  ariaLabel?: string;
  label: string;
  previousHref: string | null;
  previousLabel: string;
  nextHref: string | null;
  nextLabel: string;
  todayHref?: string;
  todayLabel?: string;
}) {
  return (
    <nav aria-label={ariaLabel} className={styles.periodNavigator}>
      {previousHref ? (
        <Link aria-label={previousLabel} className={styles.periodControl} href={previousHref}>
          <span aria-hidden="true">‹</span>
        </Link>
      ) : (
        <span aria-disabled="true" aria-label={previousLabel} className={`${styles.periodControl} ${styles.periodControlDisabled}`} role="link">
          <span aria-hidden="true">‹</span>
        </span>
      )}
      <span className={styles.periodLabel}>
        <strong>{label}</strong>
        {todayHref ? <Link aria-label={todayLabel} href={todayHref}>Today</Link> : null}
      </span>
      {nextHref ? (
        <Link aria-label={nextLabel} className={styles.periodControl} href={nextHref}>
          <span aria-hidden="true">›</span>
        </Link>
      ) : (
        <span aria-disabled="true" aria-label={nextLabel} className={`${styles.periodControl} ${styles.periodControlDisabled}`} role="link">
          <span aria-hidden="true">›</span>
        </span>
      )}
    </nav>
  );
}

export function StaffV2DetailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.detailSection}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function StaffV2SectionLabel({ children, id }: { children: ReactNode; id?: string }) {
  return <p className={styles.sectionLabel} id={id}>{children}</p>;
}

export function StaffV2EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className={styles.emptyState} role="status">
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

export function StaffV2FilterChip({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={styles.filterChip} onClick={onClick} type="button">
      <span aria-hidden="true">≡</span>
      {children}
    </button>
  );
}

export function StaffV2FormSection({
  title,
  description,
  flat = false,
  children,
}: {
  title?: string;
  description?: string;
  flat?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`${styles.formSection} ${flat ? styles.formSectionFlat : ""}`}>
      {title ? <h3>{title}</h3> : null}
      {description ? <p>{description}</p> : null}
      {children}
    </section>
  );
}

export function StaffV2AttachmentRow({
  fileName,
  status,
  action,
}: {
  fileName: string;
  status: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={styles.attachmentRow}>
      <span className={styles.attachmentCopy} title={fileName}>
        <strong>{fileName}</strong>
        <small>{status}</small>
      </span>
      {action ? <span className={styles.attachmentAction}>{action}</span> : null}
    </div>
  );
}

export function StaffV2StickyActionBar({
  children,
  aboveNavigation = false,
}: {
  children: ReactNode;
  aboveNavigation?: boolean;
}) {
  return (
    <div className={`${styles.stickyActionBar} ${aboveNavigation ? styles.stickyActionBarAboveNavigation : ""}`}>
      {children}
    </div>
  );
}
