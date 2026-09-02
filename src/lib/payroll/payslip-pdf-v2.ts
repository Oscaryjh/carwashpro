const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 34;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

export const PAYSLIP_PDF_TEMPLATE_VERSION = "MY-PAYSLIP-V2";

const COLORS = {
  teal: "0.000 0.369 0.345",
  tealDark: "0.000 0.259 0.243",
  tealSoft: "0.925 0.973 0.969",
  ink: "0.075 0.122 0.137",
  muted: "0.349 0.408 0.424",
  border: "0.820 0.855 0.855",
  canvas: "0.982 0.988 0.988",
  white: "1.000 1.000 1.000",
  rose: "0.565 0.235 0.302",
  roseSoft: "0.992 0.973 0.976",
  blue: "0.059 0.353 0.686",
  blueSoft: "0.941 0.969 0.996",
} as const;

type PdfRun = {
  business: {
    name: string;
    companyNo: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
  };
  periodStart: Date;
  status: string;
  submittedAt: Date | null;
  finalizedAt: Date | null;
};

type PdfEntry = {
  employeeCode: string;
  fullName: string;
  payBasis: string;
  attendanceDays: number;
  regularMinutes: number;
  overtimeMinutes: number;
  publicHolidayMinutes: number;
  unpaidLeaveDays?: number;
  unauthorizedAbsenceDays?: number;
  basicPay: number;
  overtimePay: number;
  publicHolidayPay: number;
  allowances: number;
  otherDeductions: number;
  epfEmployee: number;
  socsoEmployee: number;
  eisEmployee: number;
  lindung24Employee: number;
  pcb: number;
  pcbPresentation?: { pending: boolean; value: string };
  cp38: number;
  employerEpf: number;
  employerSocso: number;
  employerEis: number;
  grossPay: number;
  netPay: number;
  claimReimbursements?: Array<{ claimNumber: string; amount: number }>;
  notes: string | null;
  components?: Array<{
    name: string;
    type: "EARNING" | "DEDUCTION";
    amount: number;
    sourceType?: string;
  }>;
};

type FinancialRow = { label: string; amount: number };

class PdfCanvas {
  private pages: string[][] = [];
  private pageIndex = -1;
  y = PAGE_MARGIN;

  constructor(private readonly companyName: string) {
    this.addPage(false);
  }

  private get commands() {
    return this.pages[this.pageIndex];
  }

  addPage(continued = true) {
    this.pages.push([]);
    this.pageIndex += 1;
    this.y = PAGE_MARGIN;
    this.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, COLORS.canvas);
    if (continued) {
      this.fillRect(0, 0, PAGE_WIDTH, 34, COLORS.tealDark);
      this.text(this.companyName.toUpperCase(), PAGE_MARGIN, 12, 9, {
        bold: true,
        color: COLORS.white,
      });
      this.text("PAYSLIP - CONTINUED", PAGE_WIDTH - PAGE_MARGIN, 12, 8, {
        align: "right",
        bold: true,
        color: COLORS.white,
      });
      this.y = 48;
    }
  }

  ensure(height: number) {
    if (this.y + height > PAGE_HEIGHT - PAGE_MARGIN) this.addPage();
  }

  fillRect(x: number, y: number, width: number, height: number, color: string) {
    this.commands.push(
      `q ${color} rg ${number(x)} ${number(PAGE_HEIGHT - y - height)} ${number(width)} ${number(height)} re f Q`,
    );
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    color = COLORS.border,
    lineWidth = 0.7,
  ) {
    this.commands.push(
      `q ${color} RG ${number(lineWidth)} w ${number(x)} ${number(PAGE_HEIGHT - y - height)} ${number(width)} ${number(height)} re S Q`,
    );
  }

  line(x1: number, y1: number, x2: number, y2: number, color = COLORS.border) {
    this.commands.push(
      `q ${color} RG 0.6 w ${number(x1)} ${number(PAGE_HEIGHT - y1)} m ${number(x2)} ${number(PAGE_HEIGHT - y2)} l S Q`,
    );
  }

  text(
    value: string,
    x: number,
    y: number,
    fontSize: number,
    options: {
      align?: "left" | "right" | "center";
      bold?: boolean;
      color?: string;
      maxWidth?: number;
    } = {},
  ) {
    const safe = pdfSafeText(value);
    const width = Math.min(options.maxWidth ?? CONTENT_WIDTH, textWidth(safe, fontSize, options.bold));
    let actualX = x;
    if (options.align === "right") actualX = x - width;
    if (options.align === "center") actualX = x - width / 2;
    this.commands.push(
      `BT ${options.color ?? COLORS.ink} rg /${options.bold ? "F2" : "F1"} ${number(fontSize)} Tf 1 0 0 1 ${number(actualX)} ${number(PAGE_HEIGHT - y - fontSize)} Tm (${pdfEscape(safe)}) Tj ET`,
    );
  }

  paragraph(
    value: string,
    x: number,
    y: number,
    width: number,
    fontSize: number,
    options: { bold?: boolean; color?: string; lineHeight?: number } = {},
  ) {
    const lineHeight = options.lineHeight ?? fontSize * 1.35;
    const lines = wrapText(value, width, fontSize, options.bold);
    lines.forEach((line, index) => {
      this.text(line, x, y + index * lineHeight, fontSize, options);
    });
    return lines.length * lineHeight;
  }

  build() {
    return assemblePdf(this.pages, {
      title: `Payslip - ${this.companyName}`,
      subject: PAYSLIP_PDF_TEMPLATE_VERSION,
    });
  }
}

export function buildProfessionalPayslipPdf(run: PdfRun, entry: PdfEntry) {
  const pdf = new PdfCanvas(run.business.name);
  const pcbPending = entry.pcbPresentation?.pending === true;
  drawCompanyHeader(pdf, run);
  drawTitle(pdf, run);
  drawPaySummary(pdf, entry, pcbPending);
  drawIdentityPanel(pdf, entry);
  drawAttendance(pdf, entry);

  const componentEarnings = entry.components?.filter((item) => item.type === "EARNING") ?? [];
  const earnings = componentEarnings.length
    ? componentEarnings.map((item) => ({ label: professionalComponentLabel(item.name), amount: item.amount }))
    : [
        { label: "Basic Salary", amount: entry.basicPay },
        { label: "Overtime", amount: entry.overtimePay },
        { label: "Public Holiday Pay", amount: entry.publicHolidayPay },
        { label: "Allowances", amount: entry.allowances },
      ].filter((item) => item.amount !== 0 || item.label === "Basic Salary");
  drawFinancialSection(pdf, {
    title: "EARNINGS",
    rows: earnings,
    totalLabel: "TOTAL GROSS EARNINGS",
    total: entry.grossPay,
    tint: COLORS.tealSoft,
    accent: COLORS.tealDark,
  });

  const componentDeductions = entry.components?.filter(
    (item) => item.type === "DEDUCTION" && !isStatutoryDeductionComponent(item.name),
  ) ?? [];
  const employeeDeductions =
    entry.otherDeductions +
    entry.epfEmployee +
    entry.socsoEmployee +
    entry.eisEmployee +
    entry.lindung24Employee +
    (pcbPending ? 0 : entry.pcb) +
    entry.cp38;
  const deductionRows: FinancialRow[] = [
    ...componentDeductions.map((item) => ({
      label: professionalComponentLabel(item.name),
      amount: item.amount,
    })),
    ...(componentDeductions.length || entry.otherDeductions === 0
      ? []
      : [{ label: "Other Deduction", amount: entry.otherDeductions }]),
    { label: "EPF (Employee)", amount: entry.epfEmployee },
    { label: "SOCSO (Employee)", amount: entry.socsoEmployee },
    { label: "EIS (Employee)", amount: entry.eisEmployee },
    ...(pcbPending ? [] : [{ label: "PCB", amount: entry.pcb }]),
    ...(entry.cp38 !== 0 ? [{ label: "CP38", amount: entry.cp38 }] : []),
    ...(entry.lindung24Employee !== 0
      ? [{ label: "LINDUNG24", amount: entry.lindung24Employee }]
      : []),
  ].filter((item) => item.amount !== 0 || ["EPF (Employee)", "SOCSO (Employee)", "EIS (Employee)", "PCB"].includes(item.label));
  drawFinancialSection(pdf, {
    title: "EMPLOYEE DEDUCTIONS",
    subtitle: "Deducted from employee pay",
    rows: deductionRows,
    totalLabel: pcbPending
      ? "Current deductions (excludes pending PCB)"
      : "TOTAL DEDUCTIONS",
    total: employeeDeductions,
    tint: COLORS.roseSoft,
    accent: COLORS.rose,
  });

  if (pcbPending) {
    drawPcbPendingNotice(pdf, entry.pcbPresentation?.value ?? "Pending configuration");
  }

  const employerContributions = entry.employerEpf + entry.employerSocso + entry.employerEis;
  const employerRows: FinancialRow[] = [
    { label: "EPF (Employer)", amount: entry.employerEpf },
    { label: "SOCSO (Employer)", amount: entry.employerSocso },
    { label: "EIS (Employer)", amount: entry.employerEis },
  ];
  drawFinancialSection(pdf, {
    title: "EMPLOYER CONTRIBUTIONS",
    subtitle: "Employer-funded - does not reduce Net Pay",
    rows: employerRows,
    totalLabel: "TOTAL EMPLOYER CONTRIBUTIONS",
    total: employerContributions,
    tint: COLORS.blueSoft,
    accent: COLORS.blue,
  });

  const reimbursementRows: FinancialRow[] = entry.claimReimbursements?.map((item) => ({
    label: `Claim ${item.claimNumber}`,
    amount: item.amount,
  })) ?? [];
  assertPresentationReconciliation({
    earnings,
    grossPay: entry.grossPay,
    deductions: deductionRows,
    employeeDeductions,
    employerContributions: employerRows,
    employerContributionTotal: employerContributions,
    reimbursements: reimbursementRows,
    netPay: entry.netPay,
  });

  if (reimbursementRows.length) {
    drawFinancialSection(pdf, {
      title: "REIMBURSEMENTS",
      subtitle: "Non-wage - not part of Gross Pay",
      rows: reimbursementRows,
      totalLabel: "TOTAL REIMBURSEMENTS",
      total: sumMoney(reimbursementRows),
      tint: COLORS.tealSoft,
      accent: COLORS.tealDark,
    });
  }

  drawNetPay(pdf, entry.netPay, pcbPending);
  drawNotes(pdf, entry.notes);
  return pdf.build();
}

function drawCompanyHeader(pdf: PdfCanvas, run: PdfRun) {
  pdf.fillRect(0, 0, PAGE_WIDTH, 66, COLORS.tealDark);
  pdf.fillRect(PAGE_MARGIN, 15, 34, 34, COLORS.white);
  pdf.text(companyMonogram(run.business.name), PAGE_MARGIN + 17, 23, 16, {
    align: "center",
    bold: true,
    color: COLORS.tealDark,
  });
  const companyLines = wrapText(run.business.name.toUpperCase(), 310, 12.5, true);
  companyLines.forEach((line, index) => {
    pdf.text(line, PAGE_MARGIN + 46, 12 + index * 14, 12.5, {
      bold: true,
      color: COLORS.white,
      maxWidth: 310,
    });
  });
  const companyLine = run.business.companyNo
    ? `Company No: ${run.business.companyNo}`
    : "Company registration number not provided";
  pdf.text(companyLine, PAGE_MARGIN + 46, companyLines.length > 1 ? 44 : 36, 8.5, { color: COLORS.white });

  const status = formatStatus(run.status);
  pdf.fillRect(PAGE_WIDTH - PAGE_MARGIN - 82, 14, 82, 21, COLORS.teal);
  pdf.text(status.toUpperCase(), PAGE_WIDTH - PAGE_MARGIN - 41, 20, 8, {
    align: "center",
    bold: true,
    color: COLORS.white,
  });
  const lifecycle = run.finalizedAt
    ? `Finalized ${formatDateTime(run.finalizedAt)}`
    : run.submittedAt
      ? `Submitted ${formatDateTime(run.submittedAt)}`
      : "Draft preview";
  pdf.text(lifecycle, PAGE_WIDTH - PAGE_MARGIN, 42, 7.7, {
    align: "right",
    color: COLORS.white,
  });
  pdf.y = 74;
}

function drawTitle(pdf: PdfCanvas, run: PdfRun) {
  pdf.text(
    run.status === "FINALIZED" ? "PAYSLIP" : "DRAFT PAYSLIP PREVIEW",
    PAGE_MARGIN,
    pdf.y,
    20,
    { bold: true, color: COLORS.tealDark },
  );
  pdf.text(`Pay period: ${formatPayrollPeriod(run.periodStart)}`, PAGE_MARGIN, pdf.y + 27, 10, {
    color: COLORS.muted,
  });
  pdf.y += 44;
}

function drawPaySummary(pdf: PdfCanvas, entry: PdfEntry, pcbPending: boolean) {
  const height = 60;
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height, COLORS.white);
  pdf.strokeRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height);
  const columnWidth = CONTENT_WIDTH / 3;
  for (let index = 1; index < 3; index += 1) {
    pdf.line(PAGE_MARGIN + columnWidth * index, pdf.y + 10, PAGE_MARGIN + columnWidth * index, pdf.y + height - 10);
  }
  pdf.fillRect(PAGE_MARGIN + columnWidth * 2, pdf.y, columnWidth, height, COLORS.tealSoft);
  const summaries = [
    ["GROSS PAY", money(entry.grossPay)],
    ["TOTAL DEDUCTIONS", money(
      entry.otherDeductions + entry.epfEmployee + entry.socsoEmployee + entry.eisEmployee +
      entry.lindung24Employee + (pcbPending ? 0 : entry.pcb) + entry.cp38,
    )],
    [pcbPending ? "ESTIMATED NET PAY (BEFORE PCB)" : "NET PAY", money(entry.netPay)],
  ];
  summaries.forEach(([label, amount], index) => {
    const center = PAGE_MARGIN + columnWidth * index + columnWidth / 2;
    pdf.text(label, center, pdf.y + 13, 7.7, {
      align: "center",
      bold: true,
      color: index === 2 ? COLORS.tealDark : COLORS.muted,
    });
    pdf.text(amount, center, pdf.y + 32, index === 2 ? 15.5 : 13, {
      align: "center",
      bold: true,
      color: index === 2 ? COLORS.tealDark : COLORS.ink,
    });
  });
  pdf.y += height + 7;
}

function drawIdentityPanel(pdf: PdfCanvas, entry: PdfEntry) {
  const employeeRows: Array<[string, string]> = [
    ["Employee", entry.fullName],
    ["Employee code", entry.employeeCode],
    ["Pay basis", formatPayBasis(entry.payBasis)],
  ];
  const height = infoPanelHeight(employeeRows, CONTENT_WIDTH);
  drawInfoPanel(pdf, PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height, "EMPLOYEE INFO", employeeRows);
  pdf.y += height + 7;
}

function infoPanelHeight(rows: Array<[string, string]>, width: number) {
  const valueWidth = width - 94;
  const rowsHeight = rows.reduce((height, [, value]) => {
    return height + Math.max(14, wrapText(value, valueWidth, 7.8, true).length * 9.5);
  }, 0);
  return 27 + rowsHeight + 5;
}

function drawInfoPanel(
  pdf: PdfCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
  title: string,
  rows: Array<[string, string]>,
) {
  pdf.fillRect(x, y, width, height, COLORS.white);
  pdf.strokeRect(x, y, width, height);
  pdf.text(title, x + 10, y + 9, 8, { bold: true, color: COLORS.tealDark });
  let rowY = y + 27;
  rows.forEach(([label, value]) => {
    const valueLines = wrapText(value, width - 94, 7.8, true);
    pdf.text(label, x + 10, rowY, 7.7, { color: COLORS.muted });
    valueLines.forEach((line, index) => {
      pdf.text(line, x + width - 10, rowY + index * 9.5, 7.8, {
        align: "right",
        bold: true,
        maxWidth: width - 94,
      });
    });
    rowY += Math.max(14, valueLines.length * 9.5);
  });
}

function drawAttendance(pdf: PdfCanvas, entry: PdfEntry) {
  const unpaidAbsenceDays = entry.unauthorizedAbsenceDays ?? entry.unpaidLeaveDays ?? 0;
  const height = unpaidAbsenceDays > 0 ? 63 : 49;
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height, COLORS.white);
  pdf.strokeRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height);
  pdf.text("ATTENDANCE", PAGE_MARGIN + 10, pdf.y + 8, 8, { bold: true, color: COLORS.tealDark });
  const columns: Array<[string, string]> = [
    ["DAYS WORKED", String(entry.attendanceDays)],
    ["REGULAR HOURS", formatMinutes(entry.regularMinutes)],
    ["OVERTIME HOURS", formatMinutes(entry.overtimeMinutes)],
    ["PUBLIC HOLIDAY HOURS", formatMinutes(entry.publicHolidayMinutes)],
  ];
  const width = (CONTENT_WIDTH - 20) / columns.length;
  columns.forEach(([label, value], index) => {
    const center = PAGE_MARGIN + 10 + width * index + width / 2;
    if (index) pdf.line(PAGE_MARGIN + 10 + width * index, pdf.y + 24, PAGE_MARGIN + 10 + width * index, pdf.y + 41);
    pdf.text(label, center, pdf.y + 25, 6.8, { align: "center", color: COLORS.muted });
    pdf.text(value, center, pdf.y + 36, 9.2, { align: "center", bold: true });
  });
  if (unpaidAbsenceDays > 0) {
    pdf.text(
      `Unpaid absence: ${formatDays(unpaidAbsenceDays)}`,
      PAGE_MARGIN + 10,
      pdf.y + 50,
      7.7,
      { color: COLORS.muted },
    );
  }
  pdf.y += height + 7;
}

function drawFinancialSection(
  pdf: PdfCanvas,
  input: {
    title: string;
    subtitle?: string;
    rows: FinancialRow[];
    totalLabel: string;
    total: number;
    tint: string;
    accent: string;
  },
) {
  const headingHeight = 22;
  const tableHeaderHeight = 15;
  const rowHeight = 15;
  const totalHeight = 19;
  const rows = input.rows.length ? input.rows : [{ label: "No applicable items", amount: 0 }];
  pdf.ensure(headingHeight + tableHeaderHeight + rowHeight * Math.min(2, rows.length) + totalHeight + 8);
  let sectionStart = pdf.y;
  drawSectionHeading(pdf, input.title, input.subtitle, input.tint, input.accent, headingHeight);
  drawTableHeader(pdf, tableHeaderHeight);
  rows.forEach((row, index) => {
    if (pdf.y + rowHeight + totalHeight > PAGE_HEIGHT - PAGE_MARGIN) {
      pdf.addPage();
      sectionStart = pdf.y;
      drawSectionHeading(pdf, `${input.title} - CONTINUED`, input.subtitle, input.tint, input.accent, headingHeight);
      drawTableHeader(pdf, tableHeaderHeight);
    }
    if (index % 2 === 1) pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, rowHeight, COLORS.canvas);
    pdf.text(fitText(row.label, CONTENT_WIDTH - 135, 8.5), PAGE_MARGIN + 10, pdf.y + 4, 8.5);
    pdf.text(money(row.amount), PAGE_WIDTH - PAGE_MARGIN - 10, pdf.y + 4, 8.5, {
      align: "right",
      bold: true,
    });
    pdf.y += rowHeight;
  });
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, totalHeight, input.tint);
  pdf.text(input.totalLabel, PAGE_MARGIN + 10, pdf.y + 5, 8.3, { bold: true, color: input.accent });
  pdf.text(money(input.total), PAGE_WIDTH - PAGE_MARGIN - 10, pdf.y + 5, 8.8, {
    align: "right",
    bold: true,
    color: input.accent,
  });
  pdf.y += totalHeight;
  pdf.strokeRect(PAGE_MARGIN, sectionStart, CONTENT_WIDTH, pdf.y - sectionStart);
  pdf.y += 6;
}

function drawSectionHeading(
  pdf: PdfCanvas,
  title: string,
  subtitle: string | undefined,
  tint: string,
  accent: string,
  height: number,
) {
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height, tint);
  pdf.text(title, PAGE_MARGIN + 10, pdf.y + 7, 8.5, { bold: true, color: accent });
  if (subtitle) {
    pdf.text(fitText(subtitle, 240, 7.2), PAGE_WIDTH - PAGE_MARGIN - 10, pdf.y + 7, 7.2, {
      align: "right",
      color: COLORS.muted,
    });
  }
  pdf.y += height;
}

function drawTableHeader(pdf: PdfCanvas, height: number) {
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height, COLORS.white);
  pdf.text("DESCRIPTION", PAGE_MARGIN + 10, pdf.y + 4, 7, { bold: true, color: COLORS.muted });
  pdf.text("AMOUNT (RM)", PAGE_WIDTH - PAGE_MARGIN - 10, pdf.y + 4, 7, {
    align: "right",
    bold: true,
    color: COLORS.muted,
  });
  pdf.line(PAGE_MARGIN, pdf.y + height, PAGE_WIDTH - PAGE_MARGIN, pdf.y + height);
  pdf.y += height;
}

function drawPcbPendingNotice(pdf: PdfCanvas, value: string) {
  const lines = [
    `PCB / MTD: ${value}`,
    "PCB is not included in the current deductions or estimated net pay.",
  ];
  const height = 42;
  pdf.ensure(height + 6);
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height, COLORS.roseSoft);
  pdf.strokeRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height);
  pdf.text(lines[0], PAGE_MARGIN + 10, pdf.y + 8, 8.5, {
    bold: true,
    color: COLORS.rose,
  });
  pdf.text(lines[1], PAGE_MARGIN + 10, pdf.y + 23, 7.7, { color: COLORS.muted });
  pdf.y += height + 6;
}

function drawNetPay(pdf: PdfCanvas, amount: number, pcbPending: boolean) {
  pdf.ensure(44);
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, 36, COLORS.tealDark);
  pdf.text(
    pcbPending ? "ESTIMATED NET PAY (BEFORE PCB)" : "NET PAY",
    PAGE_MARGIN + 14,
    pdf.y + 10,
    pcbPending ? 9.5 : 11.5,
    { bold: true, color: COLORS.white },
  );
  pdf.text(money(amount), PAGE_WIDTH - PAGE_MARGIN - 14, pdf.y + 7, 17, {
    align: "right",
    bold: true,
    color: COLORS.white,
  });
  pdf.y += 36;
}

function drawNotes(pdf: PdfCanvas, notes: string | null) {
  const safeNote = employeeSafeNote(notes);
  const body = safeNote
    ? `${safeNote}\nThis is a computer-generated payslip. No signature is required.`
    : "This is a computer-generated payslip. No signature is required.";
  const lines = body.split("\n").flatMap((line) => wrapText(line, CONTENT_WIDTH - 20, 8.5));
  const height = 28 + lines.length * 11;
  pdf.ensure(height);
  pdf.fillRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height, COLORS.white);
  pdf.strokeRect(PAGE_MARGIN, pdf.y, CONTENT_WIDTH, height);
  pdf.text("NOTES", PAGE_MARGIN + 10, pdf.y + 7, 8.3, { bold: true, color: COLORS.tealDark });
  pdf.line(PAGE_MARGIN + 10, pdf.y + 21, PAGE_WIDTH - PAGE_MARGIN - 10, pdf.y + 21);
  lines.forEach((line, index) => {
    pdf.text(line, PAGE_MARGIN + 10, pdf.y + 27 + index * 11, 8.5, { color: COLORS.muted });
  });
  pdf.y += height;
}

function isStatutoryDeductionComponent(value: string) {
  return /^(?:EPF\s*\/\s*KWSP|EPF\s+Employee|SOCSO\s+Employee|EIS\s+Employee|LINDUNG\s*24\s+Employee|Monthly Tax Deduction\s*\(PCB\)|CP38\s+tax instruction)$/i.test(value.trim());
}

function assertPresentationReconciliation(input: {
  earnings: FinancialRow[];
  grossPay: number;
  deductions: FinancialRow[];
  employeeDeductions: number;
  employerContributions: FinancialRow[];
  employerContributionTotal: number;
  reimbursements: FinancialRow[];
  netPay: number;
}) {
  const reimbursementTotal = sumMoney(input.reimbursements);
  const reconciliations: Array<[string, number, number]> = [
    ["earnings", sumMoney(input.earnings), input.grossPay],
    ["employee deductions", sumMoney(input.deductions), input.employeeDeductions],
    ["employer contributions", sumMoney(input.employerContributions), input.employerContributionTotal],
    [
      "net pay",
      Math.max(0, input.grossPay - input.employeeDeductions + reimbursementTotal),
      input.netPay,
    ],
  ];
  const failed = reconciliations.find(([, visible, canonical]) => toCents(visible) !== toCents(canonical));
  if (failed) {
    throw new Error(`PAYSLIP_PRESENTATION_RECONCILIATION_FAILED:${failed[0].toUpperCase().replaceAll(" ", "_")}`);
  }
}

function sumMoney(rows: FinancialRow[]) {
  return rows.reduce((total, row) => total + row.amount, 0);
}

function toCents(value: number) {
  return Math.round(value * 100);
}

function professionalComponentLabel(value: string) {
  const normalized = value.trim();
  if (/lindung\s*24|lending\s*24/i.test(normalized)) return "LINDUNG24";
  if (/^epf\s+employee$/i.test(normalized)) return "EPF (Employee)";
  if (/^socso\s+employee$/i.test(normalized)) return "SOCSO (Employee)";
  if (/^eis\s+employee$/i.test(normalized)) return "EIS (Employee)";
  return normalized || "Payroll item";
}

function employeeSafeNote(value: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/\b(?:UAT|TEST|DEBUG|FIXTURE|TRACE|MIGRATION|INTERNAL)[_-]/i.test(trimmed)) return null;
  return trimmed;
}

function companyMonogram(value: string) {
  const character = pdfSafeText(value).match(/[A-Za-z0-9]/)?.[0];
  return (character ?? "T").toUpperCase();
}

function money(value: number) {
  return `RM ${new Intl.NumberFormat("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: true,
  }).format(value)}`;
}

function formatPayrollPeriod(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatDateTime(value: Date) {
  return new Intl.DateTimeFormat("en-MY", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  }).format(value);
}

function formatMinutes(value: number) {
  return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, "0")}m`;
}

function formatDays(value: number) {
  const precision = Number.isInteger(value) ? 0 : 2;
  return `${value.toFixed(precision)} day${value === 1 ? "" : "s"}`;
}

function formatPayBasis(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function formatStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fitText(value: string, width: number, fontSize: number, bold = false) {
  const safe = pdfSafeText(value);
  if (textWidth(safe, fontSize, bold) <= width) return safe;
  let result = safe;
  while (result.length > 1 && textWidth(`${result}...`, fontSize, bold) > width) {
    result = result.slice(0, -1);
  }
  return `${result.trimEnd()}...`;
}

function wrapText(value: string, width: number, fontSize: number, bold = false) {
  const words = pdfSafeText(value).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const originalWord of words) {
    let word = originalWord;
    while (textWidth(word, fontSize, bold) > width) {
      let cut = word.length - 1;
      while (cut > 1 && textWidth(`${word.slice(0, cut)}-`, fontSize, bold) > width) cut -= 1;
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(`${word.slice(0, cut)}-`);
      word = word.slice(cut);
    }
    const candidate = current ? `${current} ${word}` : word;
    if (textWidth(candidate, fontSize, bold) <= width) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function textWidth(value: string, fontSize: number, bold = false) {
  return value.length * fontSize * (bold ? 0.56 : 0.51);
}

function pdfSafeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "?");
}

function pdfEscape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function number(value: number) {
  return Number(value.toFixed(2)).toString();
}

function assemblePdf(
  pages: string[][],
  metadata: { title: string; subject: string },
) {
  const objects: Buffer[] = [];
  const pageObjectNumbers = pages.map((_, index) => 5 + index * 2);
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(Buffer.from(
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((value) => `${value} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ));
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"));
  pages.forEach((commands, index) => {
    const pageNumber = pageObjectNumbers[index];
    const contentNumber = pageNumber + 1;
    const stream = Buffer.from(commands.join("\n"), "ascii");
    objects.push(Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(PAGE_WIDTH)} ${number(PAGE_HEIGHT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`,
    ));
    objects.push(Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]));
  });

  const infoObjectNumber = objects.length + 1;
  objects.push(Buffer.from(
    `<< /Title (${pdfEscape(pdfSafeText(metadata.title))}) /Subject (${pdfEscape(pdfSafeText(metadata.subject))}) /Producer (Tetamu Payroll) /Keywords (${PAYSLIP_PDF_TEMPLATE_VERSION}) >>`,
  ));

  let pdf = Buffer.from("%PDF-1.4\n%TETAMU\n");
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
  });
  const xrefOffset = pdf.length;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) trailer += `${String(offset).padStart(10, "0")} 00000 n \n`;
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoObjectNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.concat([pdf, Buffer.from(trailer)]);
}
