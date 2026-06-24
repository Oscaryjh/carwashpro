type WelcomeTemplateInput = {
  businessName: string;
  customerName: string;
};

type ServiceConfirmationInput = {
  businessName: string;
  customerName: string;
  plateNumber: string;
  orderNumber: string;
  services: string[];
  total: string;
};

type ReadyForPickupInput = {
  businessName: string;
  customerName: string;
  plateNumber: string;
  orderNumber: string;
  balance: string;
};

type InvoiceSentInput = {
  businessName: string;
  customerName: string;
  plateNumber: string;
  invoiceNumber: string;
  total: string;
  paidAmount: string;
};

export function newCustomerWelcomeTemplate({
  businessName,
  customerName,
}: WelcomeTemplateInput) {
  return [
    `Hi ${customerName}, welcome to ${businessName}.`,
    "We have created your customer profile and will keep your car wash updates here.",
    "Thank you.",
  ].join("\n");
}

export function serviceConfirmationTemplate({
  businessName,
  customerName,
  plateNumber,
  orderNumber,
  services,
  total,
}: ServiceConfirmationInput) {
  return [
    `Hi ${customerName}, ${businessName} has created work order ${orderNumber} for vehicle ${plateNumber}.`,
    `Services: ${services.join(", ")}`,
    `Total: ${total}`,
    "We will notify you when your vehicle is ready for pickup.",
  ].join("\n");
}

export function readyForPickupTemplate({
  businessName,
  customerName,
  plateNumber,
  orderNumber,
  balance,
}: ReadyForPickupInput) {
  return [
    `Hi ${customerName}, your vehicle ${plateNumber} is ready for pickup at ${businessName}.`,
    `Work order: ${orderNumber}`,
    `Balance: ${balance}`,
    "Please proceed to the counter when you arrive. Thank you.",
  ].join("\n");
}

export function invoiceSentTemplate({
  businessName,
  customerName,
  plateNumber,
  invoiceNumber,
  total,
  paidAmount,
}: InvoiceSentInput) {
  return [
    `Hi ${customerName}, thank you for visiting ${businessName}.`,
    `Invoice ${invoiceNumber} for vehicle ${plateNumber} has been paid.`,
    `Total: ${total}`,
    `Paid: ${paidAmount}`,
    "We appreciate your business.",
  ].join("\n");
}
