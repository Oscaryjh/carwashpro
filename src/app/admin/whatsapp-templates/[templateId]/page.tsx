import type { BusinessIndustry, WhatsAppMessageType } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  resetWhatsAppTemplateAction,
  updateWhatsAppTemplateAction,
} from "@/app/admin/whatsapp-templates/actions";
import { AppShell } from "@/components/app-shell";
import { WhatsAppTemplateMessageEditor } from "@/components/whatsapp-template-message-editor";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  BUSINESS_INDUSTRY_OPTIONS,
  getBusinessIndustryLabel,
} from "@/lib/business-industry";
import {
  getDefaultWhatsAppTemplate,
  getWhatsAppTemplateDescription,
  getWhatsAppTemplateLabel,
  getWhatsAppTemplateVariables,
} from "@/lib/whatsapp/template-defaults";

type WhatsAppTemplateEditPageProps = {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{
    industryType?: string;
    message?: string;
    type?: string;
  }>;
};

export default async function WhatsAppTemplateEditPage({
  params,
  searchParams,
}: WhatsAppTemplateEditPageProps) {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const { templateId } = await params;
  const query = await searchParams;
  const messageType = templateId as WhatsAppMessageType;
  const selectedIndustry = parseIndustryType(query.industryType);
  const defaultTemplate = getDefaultWhatsAppTemplate(
    messageType,
    selectedIndustry,
  );

  if (!defaultTemplate) {
    notFound();
  }

  const savedTemplate = await prisma.whatsAppTemplate.findUnique({
    where: {
      messageType_industryType: {
        industryType: selectedIndustry,
        messageType,
      },
    },
  });
  const template = {
    body: savedTemplate?.body ?? defaultTemplate.body,
    status: savedTemplate?.status ?? "ACTIVE",
    title: savedTemplate?.title ?? defaultTemplate.title,
  };

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{getWhatsAppTemplateLabel(messageType, selectedIndustry)}</h1>
            <p>
              {getBusinessIndustryLabel(selectedIndustry)} WhatsApp message
              template. {getWhatsAppTemplateDescription(messageType, selectedIndustry)}
            </p>
          </div>
          <Link
            className="secondary-button"
            href={"/admin/whatsapp-templates?industryType=" + selectedIndustry}
          >
            Back
          </Link>
        </div>

        {query.message ? (
          <p
            className={`form-message ${
              query.type === "error" ? "error" : "success"
            }`}
          >
            {query.message}
          </p>
        ) : null}

        <div className="template-editor-layout">
          <form action={updateWhatsAppTemplateAction} className="panel form">
            <input type="hidden" name="messageType" value={messageType} />
            <input
              type="hidden"
              name="industryType"
              value={selectedIndustry}
            />

            <div className="field-grid">
              <label>
                <span>Title</span>
                <input name="title" required defaultValue={template.title} />
              </label>
              <label>
                <span>Status</span>
                <select name="status" defaultValue={template.status}>
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>
            </div>

            <WhatsAppTemplateMessageEditor
              defaultValue={template.body}
              industryType={selectedIndustry}
              variables={getWhatsAppTemplateVariables(selectedIndustry)}
            />

            <div className="form-actions template-actions">
              <button type="submit">Save</button>
            </div>
          </form>

          <aside className="panel template-side-panel">
            <h2>Available variables</h2>
            <p className="muted">
              Only use variables shown here. They are replaced automatically when
              the message is sent.
            </p>
            <div className="template-variable-grid">
              {getWhatsAppTemplateVariables(selectedIndustry).map((variable) => (
                <code className="template-variable-chip" key={variable}>
                  {"{{"}
                  {variable}
                  {"}}"}
                </code>
              ))}
            </div>

            <form action={resetWhatsAppTemplateAction} className="template-reset-form">
              <input type="hidden" name="messageType" value={messageType} />
              <input
                type="hidden"
                name="industryType"
                value={selectedIndustry}
              />
              <button className="secondary-button" type="submit">
                Reset default
              </button>
            </form>
          </aside>
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
