import Link from "next/link";
import { notFound } from "next/navigation";
import { BackButton } from "@/components/back-button";
import { SendWhatsAppButton } from "@/components/send-whatsapp-button";
import { WorkOrderContactForm } from "@/components/work-order-contact-form";
import { requireBusinessUser } from "@/lib/auth/business-user";
import { authorizedOperationalBranchWhere } from "@/lib/branches";
import { formatInvoiceNumber } from "@/lib/invoices/invoice-number";
import { prisma } from "@/lib/prisma";
import {
  canMoveWorkOrderStatus,
  formatOrderNumber,
} from "@/lib/validation/work-orders";
import {
  updateWorkOrderContactAction,
  updateWorkOrderStatusAction,
} from "../actions";

type WorkOrderDetailsPageProps = {
  params: Promise<{
    workOrderId: string;
  }>;
  searchParams: Promise<{
    error?: string;
    saved?: string;
  }>;
};

export default async function WorkOrderDetailsPage({
  params,
  searchParams,
}: WorkOrderDetailsPageProps) {
  const { user, businessId } = await requireBusinessUser("VIEW_WORK_ORDERS");
  const { workOrderId } = await params;
  const operationalBranchWhere = authorizedOperationalBranchWhere(user);
  const { error, saved } = await searchParams;
  const workOrder = await prisma.workOrder.findFirst({
    where: {
      id: workOrderId,
      businessId,
      ...operationalBranchWhere,
    },
    include: {
      customer: true,
      vehicle: true,
      items: {
        orderBy: { createdAt: "asc" },
      },
      invoice: true,
    },
  });

  if (!workOrder) {
    notFound();
  }

  const contactFormWorkOrder = {
    id: workOrder.id,
    contactType: workOrder.contactType,
    contactName: workOrder.contactName,
    contactPhone: workOrder.contactPhone,
    customer: {
      name: workOrder.customer.name,
      phone: workOrder.customer.phone,
    },
  };

  return (
    <>
      <section className="content">
        <div className="page-header">
          <div>
            <h1>{formatOrderNumber(workOrder.orderNumber)}</h1>
            <p>{formatStatus(workOrder.status)}</p>
          </div>
          <BackButton fallbackHref="/work-orders" />
        </div>

        {error ? <p className="error">{error}</p> : null}
        {saved ? <p className="success">{saved}</p> : null}

        <div className="grid">
          <Info label="Customer" value={`${workOrder.customer.name} - ${workOrder.customer.phone}`} />
          <Info
            label="Pick up contact"
            value={`${formatStatus(workOrder.contactType)} - ${
              workOrder.contactName || workOrder.customer.name
            } - ${workOrder.contactPhone || workOrder.customer.phone}`}
          />
          <Info label="Vehicle" value={vehicleLabel(workOrder.vehicle)} />
          <Info label="Subtotal" value={Number(workOrder.subtotal).toFixed(2)} />
          <Info label="Total" value={Number(workOrder.total).toFixed(2)} />
          <Info label="Paid" value={Number(workOrder.paidAmount).toFixed(2)} />
          <Info label="Balance" value={Number(workOrder.balance).toFixed(2)} />
          <Info label="Payment" value={formatStatus(workOrder.paymentStatus)} />
          {workOrder.pickedUpAt ? (
            <Info label="Picked up" value={formatDateTime(workOrder.pickedUpAt)} />
          ) : null}
        </div>

        <WorkOrderContactForm
          action={updateWorkOrderContactAction}
          workOrder={contactFormWorkOrder}
        />

        <div className="panel work-order-compact-panel work-order-action-panel">
          <div className="section-header">
            <h2>Status</h2>
            <span className="status">{formatStatus(workOrder.status)}</span>
          </div>
          <div className="inline-actions">
            {["IN_PROGRESS", "READY_FOR_PICKUP", "COMPLETED", "CANCELLED"].map(
              (status) =>
                canMoveWorkOrderStatus(workOrder.status, status) ? (
                  <form action={updateWorkOrderStatusAction} key={status}>
                    <input type="hidden" name="workOrderId" value={workOrder.id} />
                    <input type="hidden" name="status" value={status} />
                    <button type="submit">{statusActionLabel(status)}</button>
                  </form>
                ) : null,
            )}
          </div>
        </div>

        <div className="panel work-order-compact-panel work-order-action-panel">
          <div className="section-header">
            <h2>Payment</h2>
            <span className="status">{formatStatus(workOrder.paymentStatus)}</span>
          </div>
          <div className="inline-actions">
            {workOrder.paymentStatus !== "PAID" && workOrder.status !== "CANCELLED" ? (
              <Link className="button-link" href={`/pos/${workOrder.id}`}>
                Go to POS
              </Link>
            ) : null}
            {workOrder.invoice ? (
              <Link href={`/invoices/${workOrder.invoice.id}`}>
                View invoice {formatInvoiceNumber(workOrder.invoice.invoiceNumber)}
              </Link>
            ) : null}
          </div>
        </div>

        <div className="panel work-order-compact-panel work-order-action-panel">
          <div className="section-header">
            <h2>WhatsApp</h2>
            <span className="status">manual</span>
          </div>
          <div className="inline-actions">
            <SendWhatsAppButton
              customerId={workOrder.customer.id}
              label="Send WhatsApp"
              messageType="NEW_CUSTOMER_WELCOME"
            />
            <SendWhatsAppButton
              label="Send WhatsApp"
              messageType="SERVICE_CONFIRMATION"
              workOrderId={workOrder.id}
            />
            {workOrder.status === "READY_FOR_PICKUP" ||
            workOrder.status === "COMPLETED" ? (
              <SendWhatsAppButton
                label="Send Pickup WhatsApp"
                messageType="READY_FOR_PICKUP"
                workOrderId={workOrder.id}
              />
            ) : null}
            {workOrder.invoice ? (
              <SendWhatsAppButton
                invoiceId={workOrder.invoice.id}
                label="Send Invoice WhatsApp"
                messageType="INVOICE_SENT"
              />
            ) : null}
          </div>
        </div>

        <div className="panel">
          <h2>Service items</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Qty</th>
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {workOrder.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.quantity}</td>
                  <td>{Number(item.unitPrice).toFixed(2)}</td>
                  <td>{Number(item.lineTotal).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {workOrder.notes ? (
          <div className="panel">
            <h2>Notes</h2>
            <p>{workOrder.notes}</p>
          </div>
        ) : null}
      </section>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel metric">
      <span>{label}</span>
      <strong style={{ fontSize: 15, overflowWrap: "anywhere" }}>{value}</strong>
    </div>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function statusActionLabel(nextStatus: string) {
  if (nextStatus === "READY_FOR_PICKUP") {
    return "Ready for pickup";
  }

  if (nextStatus === "COMPLETED") {
    return "Vehicle Collected";
  }

  return formatStatus(nextStatus);
}

function formatDateTime(date: Date) {
  return date.toLocaleString("en-MY", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function vehicleLabel(vehicle: { plateNumber: string; brand: string | null; model: string | null; color: string | null }) {
  const details = [vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(" ");
  return details ? `${vehicle.plateNumber} - ${details}` : vehicle.plateNumber;
}
