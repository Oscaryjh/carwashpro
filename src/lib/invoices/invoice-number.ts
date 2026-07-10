export function makeInvoiceNumber() {
  const now = new Date();
  const year = String(now.getFullYear()).slice(-2);
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 5).toUpperCase();

  return `INV-${year}${month}${day}-${hour}${minute}${suffix}`;
}

export function formatInvoiceNumber(invoiceNumber: string | null | undefined) {
  if (!invoiceNumber) {
    return "";
  }

  const oldFormat = invoiceNumber.match(
    /^INV-(20\d{6})-[^-]+-([A-Z0-9]{4})$/i,
  );

  if (oldFormat) {
    return `INV-${oldFormat[1].slice(2)}-${oldFormat[2].toUpperCase()}`;
  }

  return invoiceNumber;
}
