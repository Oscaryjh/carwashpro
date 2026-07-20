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
  const templates = DEFAULT_WHATSAPP_TEMPLATES_BY_INDUSTRY[selectedIndustry].map(
    (defaultTemplate, index) => {
    const savedTemplate = savedByType.get(defaultTemplate.messageType);
    return {
      body:
        savedTemplate?.body ??
        getDefaultWhatsAppTemplate(defaultTemplate.messageType, selectedIndustry)
          ?.body ??
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
    },
  );

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp Templates</h1>
            <p>
              Manage default WhatsApp automation messages for{" "}
              {getBusinessIndustryLabel(selectedIndustry)}.
            </p>
          </div>
        </div>

        <div className="panel">
          <form className="template-industry-filter" method="get">
            <label>
              <span>Industry</span>
              <select name="industryType" defaultValue={selectedIndustry}>
                {BUSINESS_INDUSTRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">View templates</button>
          </form>
          <table className="table">
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
                    <div className="muted template-preview">{template.body}</div>
                  </td>
                  <td>
                    <strong>
                      {getWhatsAppTemplateLabel(
                        template.messageType,
                        selectedIndustry,
                      )}
                    </strong>
                    <div className="muted template-purpose">
                      {template.description}
                    </div>
                  </td>
                  <td>
                    <span className={`status ${template.status.toLowerCase()}`}>
                      {template.status.toLowerCase()}
                    </span>
                  </td>
                  <td>
                    {template.updatedAt
                      ? template.updatedAt.toLocaleString()
                      : "Default"}
                  </td>
                  <td>
                    <Link
                      href={"/admin/whatsapp-templates/" + template.messageType + "?industryType=" + selectedIndustry}
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
    </AppShell>
  );
}

function parseIndustryType(value?: string): BusinessIndustry {
  return BUSINESS_INDUSTRY_OPTIONS.some((option) => option.value === value)
    ? (value as BusinessIndustry)
    : "AUTO_DETAILING";
}
