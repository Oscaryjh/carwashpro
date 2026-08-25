import type { BusinessIndustry } from "@prisma/client";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  BUSINESS_INDUSTRY_OPTIONS,
  getBusinessIndustryLabel,
} from "@/lib/business-industry";
import {
  DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY,
  getDefaultWhatsAppTemplate,
  getWhatsAppTemplateDescription,
  getWhatsAppTemplateLabel,
} from "@/lib/whatsapp/template-defaults";
import styles from "../admin-directory.module.css";

type AdminWhatsAppTemplatesPageProps = {
  searchParams: Promise<{ industryType?: string }>;
};

export default async function AdminWhatsAppTemplatesPage({
  searchParams,
}: AdminWhatsAppTemplatesPageProps) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);
  const query = await searchParams;
  const selectedIndustry = parseIndustryType(query.industryType);

  const savedTemplates = await prisma.whatsAppTemplate.findMany({
    where: { industryType: selectedIndustry },
  });
  const savedByType = new Map(
    savedTemplates.map((template) => [template.messageType, template]),
  );
  const templates = DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY[
    selectedIndustry
  ].map((defaultTemplate, index) => {
    const savedTemplate = savedByType.get(defaultTemplate.messageType);
    return {
      body:
        savedTemplate?.body ??
        getDefaultWhatsAppTemplate(
          defaultTemplate.messageType,
          selectedIndustry,
        )?.body ??
        defaultTemplate.body,
      index: index + 1,
      messageType: defaultTemplate.messageType,
      status: savedTemplate?.status ?? "ACTIVE",
      title: savedTemplate?.title ?? defaultTemplate.title,
      description: getWhatsAppTemplateDescription(
        defaultTemplate.messageType,
        selectedIndustry,
      ),
      updatedAt: savedTemplate?.updatedAt ?? null,
    };
  });
  const activeTemplates = templates.filter(
    (template) => template.status === "ACTIVE",
  ).length;

  return (
    <AppShell user={user}>
      <section className={styles.page}>
        <header className={styles.hero}>
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}>Customer communication</p>
            <h1>WhatsApp Templates</h1>
            <p className={styles.heroDescription}>
              Review and edit the messages customers receive automatically.
              Templates are organized by industry so the wording stays relevant.
            </p>
          </div>
          <span className={styles.countBadge}>
            {getBusinessIndustryLabel(selectedIndustry)}
          </span>
        </header>

        <section
          className={styles.metrics}
          aria-label="WhatsApp template summary"
        >
          <article className={styles.metric}>
            <span>Templates</span>
            <strong>{templates.length}</strong>
            <small>Available for this industry</small>
          </article>
          <article className={styles.metric}>
            <span>Active</span>
            <strong>{activeTemplates}</strong>
            <small>Ready for automation</small>
          </article>
          <article className={styles.metric}>
            <span>Customized</span>
            <strong>{savedTemplates.length}</strong>
            <small>Saved platform wording</small>
          </article>
          <article className={styles.metric}>
            <span>Using defaults</span>
            <strong>{templates.length - savedTemplates.length}</strong>
            <small>Platform copy is unchanged</small>
          </article>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>Message library</h2>
              <p>
                Select an industry, then open any message to update its wording
                or status.
              </p>
            </div>
            <span className={styles.countBadge}>
              {templates.length} messages
            </span>
          </div>
          <form
            className={`${styles.toolbar} ${styles.toolbarCompact}`}
            method="get"
          >
            <label className={styles.field}>
              <span>Business industry</span>
              <select name="industryType" defaultValue={selectedIndustry}>
                {BUSINESS_INDUSTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Show templates</button>
          </form>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Template</th>
                  <th>Purpose</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((template) => (
                  <tr key={template.messageType}>
                    <td>{template.index}</td>
                    <td>
                      <strong>{template.title}</strong>
                      <div className={`${styles.subtext} ${styles.preview}`}>
                        {template.body}
                      </div>
                    </td>
                    <td>
                      <strong>
                        {getWhatsAppTemplateLabel(
                          template.messageType,
                          selectedIndustry,
                        )}
                      </strong>
                      <div className={styles.subtext}>
                        {template.description}
                      </div>
                    </td>
                    <td>
                      <span
                        className={`${styles.statusBadge} ${template.status === "ACTIVE" ? "" : styles.statusBadgeInactive}`}
                      >
                        {template.status === "ACTIVE" ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      {template.updatedAt
                        ? template.updatedAt.toLocaleString("en-MY")
                        : "Default"}
                    </td>
                    <td>
                      <Link
                        className={styles.rowAction}
                        href={
                          "/admin/whatsapp-templates/" +
                          template.messageType +
                          "?industryType=" +
                          selectedIndustry
                        }
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </AppShell>
  );
}

function parseIndustryType(value?: string): BusinessIndustry {
  return BUSINESS_INDUSTRY_OPTIONS.some((option) => option.value === value)
    ? (value as BusinessIndustry)
    : "AUTO_DETAILING";
}
