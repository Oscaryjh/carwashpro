import type {
  GroupReportInvoiceRow,
  GroupReportsResult,
} from "@/lib/business-groups/group-reports";

export type GroupReportExportFormat = "csv" | "xlsx" | "pdf";

export function buildGroupReportExportRows(report: GroupReportsResult) {
  const summary = report.summary;
  return [
    ["Group", report.groupName],
    ["Currency", "MYR"],
    ["Store filter", report.filters.storeId ?? "All authorized stores"],
    ["Gross sales", centsValue(summary.grossSalesCents)],
    ["Net sales", centsValue(summary.netSalesCents)],
    ["Payments collected", centsValue(summary.paymentsCollectedCents)],
    ["Refunds", centsValue(summary.refundsCents)],
    ["Transactions", summary.transactionCount],
    [
      "Average transaction",
      summary.averageTransactionValueCents === null
        ? ""
        : centsValue(summary.averageTransactionValueCents),
    ],
    [],
    [
      "Invoice",
      "Store",
      "Business date",
      "Customer",
      "Gross",
      "Discount",
      "Tip",
      "Package",
      "Net invoice",
      "Collected",
      "Refund",
      "Balance",
      "Status",
      "Methods",
    ],
    ...report.rows.map(invoiceExportRow),
  ] satisfies Array<Array<string | number>>;
}

export function buildGroupReportCsv(report: GroupReportsResult) {
  const rows = buildGroupReportExportRows(report);
  return Buffer.from(
    `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`,
    "utf8",
  );
}

export function buildGroupReportXlsx(report: GroupReportsResult) {
  const rows = buildGroupReportExportRows(report);
  const entries = [
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Group Report" sheetId="1" r:id="rId1"/></sheets>' +
        "</workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content: worksheetXml(rows),
    },
  ];
  return zipStored(entries);
}

export function buildGroupReportPdf(report: GroupReportsResult) {
  const summaryLines = [
    `GROUP REPORT - ${report.groupName}`,
    `Gross sales: ${money(report.summary.grossSalesCents)}`,
    `Net sales: ${money(report.summary.netSalesCents)}`,
    `Payments collected: ${money(report.summary.paymentsCollectedCents)}`,
    `Refunds: ${money(report.summary.refundsCents)}`,
    `Transactions: ${report.summary.transactionCount}`,
    "",
    "Invoice | Store | Business date | Net | Collected | Refund | Status",
  ];
  const transactionLines = report.rows.map(
    (row) =>
      `${row.invoiceNumber} | ${row.businessName} | ${row.businessDate} | ${money(row.netInvoiceAmountCents)} | ${money(row.paidAmountCents)} | ${money(row.refundAmountCents)} | ${row.invoiceStatus}`,
  );
  return buildTextPdf([...summaryLines, ...transactionLines]);
}

export function groupReportExportFileName(
  report: GroupReportsResult,
  extension: GroupReportExportFormat,
) {
  const safeGroup =
    report.groupName.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") ||
    "group";
  return `${safeGroup.slice(0, 60)}-report.${extension}`;
}

function invoiceExportRow(row: GroupReportInvoiceRow) {
  return [
    row.invoiceNumber,
    row.businessName,
    row.businessDate,
    row.customerName ?? "Walk-in",
    centsValue(row.grossAmountCents),
    centsValue(row.discountCents),
    centsValue(row.tipCents),
    centsValue(row.packageRedemptionCents),
    centsValue(row.netInvoiceAmountCents),
    centsValue(row.paidAmountCents),
    centsValue(row.refundAmountCents),
    centsValue(row.balanceCents),
    row.invoiceStatus,
    row.paymentMethods.join(", "),
  ];
}

function centsValue(value: number) {
  return value / 100;
}

function csvCell(value: string | number) {
  const raw = String(value);
  const safe = /^[\t\r\n ]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function worksheetXml(rows: Array<Array<string | number>>) {
  const body = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => {
            const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
            return typeof value === "number"
              ? `<c r="${reference}"><v>${value}</v></c>`
              : `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

function columnName(index: number) {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function zipStored(entries: Array<{ name: string; content: string }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.content, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildTextPdf(lines: string[]) {
  const chunks = chunk(lines.flatMap((line) => wrap(line, 100)), 44);
  const objects: Buffer[] = [];
  const pageObjectNumbers = chunks.map((_, index) => 4 + index * 2);
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(
    Buffer.from(
      `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${chunks.length} >>`,
    ),
  );
  objects.push(
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  );
  chunks.forEach((pageLines, index) => {
    const pageNumber = pageObjectNumbers[index];
    const streamNumber = pageNumber + 1;
    const commands = [
      "BT /F1 9 Tf 42 800 Td",
      ...pageLines.flatMap((line, lineIndex) => [
        lineIndex ? "0 -17 Td" : "",
        `(${pdfEscape(line)}) Tj`,
      ]),
      "ET",
    ]
      .filter(Boolean)
      .join("\n");
    const stream = Buffer.from(commands, "utf8");
    objects.push(
      Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamNumber} 0 R >>`,
      ),
      Buffer.concat([
        Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
        stream,
        Buffer.from("\nendstream"),
      ]),
    );
  });
  return assemblePdf(objects);
}

function assemblePdf(objects: Buffer[]) {
  let pdf = Buffer.from("%PDF-1.4\n");
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
  });
  const xrefOffset = pdf.length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    trailer += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.concat([pdf, Buffer.from(trailer)]);
}

function wrap(value: string, maxLength: number) {
  if (!value) return [""];
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word.slice(0, maxLength);
    } else if (`${current} ${word}`.length <= maxLength) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word.slice(0, maxLength);
    }
  }
  if (current) lines.push(current);
  return lines;
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result.length ? result : [[]];
}

function pdfEscape(value: string) {
  return value
    .replace(/[^\x20-\x7e]/g, "?")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function money(value: number) {
  return `RM ${(value / 100).toFixed(2)}`;
}
