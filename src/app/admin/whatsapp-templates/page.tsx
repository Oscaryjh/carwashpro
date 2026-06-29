import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { assertRole } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { DEFAULT_WHATSAPP_TEMPLATES } from "@/lib/whatsapp/template-defaults";

export default async function AdminWhatsAppTemplatesPage() {
  const user = await requireUser();
  assertRole(user, ["PLATFORM_ADMIN"]);

  const savedTemplates = await prisma.whatsAppTemplate.findMany();
  const savedByType = new Map(
    savedTemplates.map((template) => [template.messageType, template]),
  );
  const templates = DEFAULT_WHATSAPP_TEMPLATES.map((defaultTemplate, index) => {
    const savedTemplate = savedByType.get(defaultTemplate.messageType);
    return {
      body: savedTemplate?.body ?? defaultTemplate.body,
      index: index + 1,
      messageType: defaultTemplate.messageType,
      status: savedTemplate?.status ?? "ACTIVE",
      title: savedTemplate?.title ?? defaultTemplate.title,
      updatedAt: savedTemplate?.updatedAt ?? null,
    };
  });

  return (
    <AppShell user={user}>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>WhatsApp Templates</h1>
            <p>Manage platform default WhatsApp automation messages.</p>
          </div>
        </div>

        <div className="panel">
          <table className="table">
            <thead>
              <tr>
                <th>No.</th>
                <th>Template</th>
                <th>Trigger</th>
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
                  <td>{formatMessageType(template.messageType)}</td>
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
                      href={`/admin/whatsapp-templates/${template.messageType}`}
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

function formatMessageType(messageType: string) {
  return messageType.toLowerCase().replaceAll("_", " ");
}
