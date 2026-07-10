import { deflateSync, inflateSync } from "node:zlib";

type InvoicePdfItem = {
  name: string;
  quantity: number;
  unitPrice: unknown;
  lineTotal: unknown;
};

type InvoicePdfInput = {
  company: {
    address?: string | null;
    companyNo?: string | null;
    logo?: InvoicePdfLogo | null;
    name: string;
    phone?: string | null;
  };
  customer: {
    name: string;
    phone: string;
  };
  invoiceNumber: string;
  issuedAt: Date;
  items: InvoicePdfItem[];
  paidAmount: unknown;
  cashPaidAmount?: unknown;
  packageVoucherAmount?: unknown;
  balance: unknown;
  status: string;
  subtotal: unknown;
  total: unknown;
  vehicle: {
    brand?: string | null;
    color?: string | null;
    model?: string | null;
    plateNumber: string;
  };
};

type TextStyle = {
  font?: "regular" | "bold";
  size?: number;
};

type InvoicePdfLogo = {
  data: Buffer;
  mimeType?: string | null;
};

type PreparedPdfImage = {
  data: Buffer;
  filter: "DCTDecode" | "FlateDecode";
  height: number;
  width: number;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LOGO_SIZE = 72;

export function buildInvoicePdf(input: InvoicePdfInput) {
  const commands: string[] = [];
  const logoImage = preparePdfImage(input.company.logo ?? null);
  const companyTextX = logoImage ? 136 : 50;

  const text = (
    value: string,
    x: number,
    y: number,
    style: TextStyle = {},
  ) => {
    const font = style.font === "bold" ? "F2" : "F1";
    const size = style.size ?? 10;
    commands.push(
      `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdfText(
        value,
      )}) Tj ET`,
    );
  };

  const rightText = (
    value: string,
    rightX: number,
    y: number,
    style: TextStyle = {},
  ) => {
    const size = style.size ?? 10;
    const width = safePdfText(value).length * size * 0.54;
    text(value, rightX - width, y, style);
  };

  const line = (x1: number, y1: number, x2: number, y2: number) => {
    commands.push(
      `q 0.82 0.86 0.90 RG 0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(
        2,
      )} ${y2.toFixed(2)} l S Q`,
    );
  };

  const fillRect = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => {
    commands.push(
      `q ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(
        2,
      )} ${height.toFixed(2)} re f Q`,
    );
  };

  const vehicleName = [input.vehicle.brand, input.vehicle.model, input.vehicle.color]
    .filter(Boolean)
    .join(" ");

  if (logoImage) {
    const { width, height } = fitImage(logoImage, LOGO_SIZE, LOGO_SIZE);
    const x = 50;
    const y = 724 + (LOGO_SIZE - height) / 2;
    commands.push(
      `q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(
        2,
      )} cm /Im1 Do Q`,
    );
  }

  text(input.company.name, companyTextX, 785, { font: "bold", size: 18 });
  if (input.company.companyNo) {
    text(`Company No. ${input.company.companyNo}`, companyTextX, 766, { font: "bold" });
  }
  if (input.company.phone) {
    text(`WhatsApp No. ${input.company.phone}`, companyTextX, 751, { font: "bold" });
  }
  if (input.company.address) {
    wrapText(input.company.address, logoImage ? 70 : 82).forEach((lineText, index) => {
      text(lineText, companyTextX, 736 - index * 14, { size: 9 });
    });
  }

  text(invoiceStatusLabel(input.status), 480, 785, { font: "bold", size: 11 });
  line(50, 715, 545, 715);

  text("Invoice No.", 50, 692, { font: "bold", size: 9 });
  text(input.invoiceNumber, 50, 675, { font: "bold", size: 14 });
  text(formatDate(input.issuedAt), 50, 658, { font: "bold", size: 9 });

  text("Vehicle", 330, 692, { font: "bold", size: 9 });
  text(input.vehicle.plateNumber, 330, 670, { font: "bold", size: 22 });
  if (vehicleName) {
    text(vehicleName, 330, 653, { font: "bold", size: 9 });
  }
  line(50, 635, 545, 635);

  text("Customer", 50, 612, { font: "bold", size: 9 });
  text(input.customer.name, 50, 595, { font: "bold", size: 11 });
  text("Phone", 330, 612, { font: "bold", size: 9 });
  text(input.customer.phone, 330, 595, { font: "bold", size: 11 });
  line(50, 575, 545, 575);

  text("ITEM", 315, 555, { font: "bold", size: 9 });
  text("QTY", 420, 555, { font: "bold", size: 9 });
  rightText("TOTAL", 545, 555, { font: "bold", size: 9 });
  line(50, 540, 545, 540);

  let y = 517;
  input.items.forEach((item) => {
    text(item.name, 50, y, { font: "bold", size: 10 });
    text(formatMoney(item.unitPrice), 50, y - 14, { size: 9 });
    text(String(item.quantity), 425, y, { size: 10 });
    rightText(formatMoney(item.lineTotal), 545, y, { font: "bold", size: 10 });
    line(50, y - 28, 545, y - 28);
    y -= 44;
  });

  const totalsY = Math.max(y - 8, 170);
  text("Subtotal", 50, totalsY, { font: "bold", size: 9 });
  rightText(formatMoney(input.subtotal), 545, totalsY, { font: "bold", size: 16 });
  text("Total", 50, totalsY - 28, { font: "bold", size: 9 });
  rightText(formatMoney(input.total), 545, totalsY - 28, { font: "bold", size: 16 });
  const hasPackageVoucher = Number(input.packageVoucherAmount ?? 0) > 0;

  if (hasPackageVoucher) {
    text("Package voucher", 50, totalsY - 56, { font: "bold", size: 9 });
    rightText(formatMoney(input.packageVoucherAmount), 545, totalsY - 56, {
      font: "bold",
      size: 16,
    });
    text("Cash paid", 50, totalsY - 84, { font: "bold", size: 9 });
    rightText(formatMoney(input.cashPaidAmount), 545, totalsY - 84, {
      font: "bold",
      size: 16,
    });
  } else {
    text("Paid", 50, totalsY - 56, { font: "bold", size: 9 });
    rightText(formatMoney(input.paidAmount), 545, totalsY - 56, {
      font: "bold",
      size: 16,
    });
  }

  const balanceY = hasPackageVoucher ? totalsY - 140 : totalsY - 112;
  fillRect(50, balanceY, 495, 42, "0.91 0.97 0.95");
  text("Balance", 62, balanceY + 18, { font: "bold", size: 9 });
  rightText(formatMoney(input.balance), 530, balanceY + 12, {
    font: "bold",
    size: 22,
  });

  return buildPdf(commands.join("\n"), logoImage);
}

export function invoicePdfFileName(invoiceNumber: string) {
  const safeInvoiceNumber =
    invoiceNumber.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "invoice";

  return `${safeInvoiceNumber}.pdf`;
}

function buildPdf(content: string, logoImage: PreparedPdfImage | null) {
  const contentBuffer = Buffer.from(content, "utf8");
  const contentStream = streamObject(contentBuffer);
  const objects: Buffer[] = logoImage
    ? [
        objectBuffer("<< /Type /Catalog /Pages 2 0 R >>"),
        objectBuffer("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        objectBuffer(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 7 0 R >>`,
        ),
        objectBuffer("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
        objectBuffer("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
        imageObject(logoImage),
        contentStream,
      ]
    : [
        objectBuffer("<< /Type /Catalog /Pages 2 0 R >>"),
        objectBuffer("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
        objectBuffer(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
        ),
        objectBuffer("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
        objectBuffer("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"),
        contentStream,
      ];

  let pdf = Buffer.from("%PDF-1.4\n", "utf8");
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([
      pdf,
      Buffer.from(`${index + 1} 0 obj\n`, "utf8"),
      object,
      Buffer.from("\nendobj\n", "utf8"),
    ]);
  });

  const xrefOffset = pdf.length;
  let trailer = `xref\n0 ${objects.length + 1}\n`;
  trailer += "0000000000 65535 f \n";
  offsets.slice(1).forEach((offset) => {
    trailer += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.concat([pdf, Buffer.from(trailer, "utf8")]);
}

function objectBuffer(value: string) {
  return Buffer.from(value, "utf8");
}

function streamObject(value: Buffer) {
  return Buffer.concat([
    Buffer.from(`<< /Length ${value.length} >>\nstream\n`, "utf8"),
    value,
    Buffer.from("\nendstream", "utf8"),
  ]);
}

function imageObject(image: PreparedPdfImage) {
  return Buffer.concat([
    Buffer.from(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${image.filter} /Length ${image.data.length} >>\nstream\n`,
      "utf8",
    ),
    image.data,
    Buffer.from("\nendstream", "utf8"),
  ]);
}

function fitImage(image: PreparedPdfImage, maxWidth: number, maxHeight: number) {
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);

  return {
    width: image.width * scale,
    height: image.height * scale,
  };
}

function preparePdfImage(logo: InvoicePdfLogo | null): PreparedPdfImage | null {
  if (!logo?.data.length) {
    return null;
  }

  if (isJpeg(logo.data)) {
    const size = readJpegSize(logo.data);

    return size
      ? {
          ...size,
          data: logo.data,
          filter: "DCTDecode",
        }
      : null;
  }

  if (isPng(logo.data)) {
    const decoded = decodePngToRgb(logo.data);

    return decoded
      ? {
          width: decoded.width,
          height: decoded.height,
          data: deflateSync(decoded.rgb),
          filter: "FlateDecode",
        }
      : null;
  }

  return null;
}

function isJpeg(value: Buffer) {
  return value[0] === 0xff && value[1] === 0xd8;
}

function isPng(value: Buffer) {
  return value.subarray(0, 8).equals(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
}

function readJpegSize(value: Buffer) {
  let offset = 2;

  while (offset + 9 < value.length) {
    if (value[offset] !== 0xff) {
      return null;
    }

    const marker = value[offset + 1];
    const length = value.readUInt16BE(offset + 2);

    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: value.readUInt16BE(offset + 5),
        width: value.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + length;
  }

  return null;
}

function decodePngToRgb(value: Buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset + 12 <= value.length) {
    const length = value.readUInt32BE(offset);
    const type = value.subarray(offset + 4, offset + 8).toString("ascii");
    const data = value.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    }

    if (type === "IDAT") {
      idatChunks.push(data);
    }

    if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (!width || !height || bitDepth !== 8 || interlace !== 0) {
    return null;
  }

  if (colorType !== 2 && colorType !== 6) {
    return null;
  }

  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const raw = Buffer.alloc(stride * height);
  let inputOffset = 0;

  for (let row = 0; row < height; row += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    const rowOffset = row * stride;
    const previousRowOffset = rowOffset - stride;

    for (let index = 0; index < stride; index += 1) {
      const byte = inflated[inputOffset + index];
      const left = index >= bytesPerPixel ? raw[rowOffset + index - bytesPerPixel] : 0;
      const up = row > 0 ? raw[previousRowOffset + index] : 0;
      const upLeft =
        row > 0 && index >= bytesPerPixel
          ? raw[previousRowOffset + index - bytesPerPixel]
          : 0;

      raw[rowOffset + index] = (byte + pngFilterValue(filter, left, up, upLeft)) & 0xff;
    }

    inputOffset += stride;
  }

  const rgb = Buffer.alloc(width * height * 3);

  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * bytesPerPixel;
    const target = pixel * 3;
    const alpha = colorType === 6 ? raw[source + 3] : 255;

    rgb[target] = composeOverWhite(raw[source], alpha);
    rgb[target + 1] = composeOverWhite(raw[source + 1], alpha);
    rgb[target + 2] = composeOverWhite(raw[source + 2], alpha);
  }

  return { width, height, rgb };
}

function pngFilterValue(filter: number, left: number, up: number, upLeft: number) {
  if (filter === 0) {
    return 0;
  }

  if (filter === 1) {
    return left;
  }

  if (filter === 2) {
    return up;
  }

  if (filter === 3) {
    return Math.floor((left + up) / 2);
  }

  if (filter === 4) {
    return paethPredictor(left, up, upLeft);
  }

  return 0;
}

function paethPredictor(left: number, up: number, upLeft: number) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  if (upDistance <= upLeftDistance) {
    return up;
  }

  return upLeft;
}

function composeOverWhite(channel: number, alpha: number) {
  return Math.round((channel * alpha + 255 * (255 - alpha)) / 255);
}

function formatMoney(value: unknown) {
  return `RM${Number(value ?? 0).toFixed(2)}`;
}

function formatDate(value: Date) {
  return value.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function invoiceStatusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function wrapText(value: string, maxChars: number) {
  const words = safePdfText(value).split(/\s+/);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const nextLine = line ? `${line} ${word}` : word;

    if (nextLine.length > maxChars) {
      if (line) {
        lines.push(line);
      }
      line = word;
    } else {
      line = nextLine;
    }
  });

  if (line) {
    lines.push(line);
  }

  return lines.slice(0, 3);
}

function escapePdfText(value: string) {
  return safePdfText(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function safePdfText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "?");
}
