import type { WhatsAppMessageType } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  resetWhatsAppTemplateAction,
  updateWhatsAppTemplateAction,
} from "@/app/admin/whatsapp-templates/actions";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  getDefaultWhatsAppTemplate,
  WHATSAPP_TEMPLATE_VARIABLES,
} from "@/lib/whatsapp/template-defaults";

type WhatsAppTemplateEditPageProps = {
  params: Promise<{ templateId: string }>;
  searchParams: Promise<{ message?: string; type?: string }>;
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
  const defaultTemplate = getDefaultWhatsAppTemplate(messageType);

  if (!defaultTemplate) {
    notFound();
  }

  const savedTemplate = await prisma.whatsAppTemplate.findUnique({
    where: { messageType },
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
            <h1>{template.title}</h1>
            <p>Platform default WhatsApp message template.</p>
          </div>
          <Link className="secondary-button" href="/admin/whatsapp-templates">
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

            <label>
              <span>Message body</span>
              <textarea
                className="template-body"
                name="body"
                required
                defaultValue={template.body}
              />
            </label>

            <div className="form-actions template-actions">
              <button type="submit">Save</button>
            </div>
          </form>

          <aside className="panel template-side-panel">
            <h2>Variables</h2>
            <p className="muted">
              Use these placeholders inside the message. The system will replace
              them automatically.
            </p>
            <div className="template-variable-grid">
              {WHATSAPP_TEMPLATE_VARIABLES.map((variable) => (
                <code className="template-variable-chip" key={variable}>
                  {"{{"}
                  {variable}
                  {"}}"}
                </code>
              ))}
            </div>

            <form action={resetWhatsAppTemplateAction} className="template-reset-form">
              <input type="hidden" name="messageType" value={messageType} />
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
