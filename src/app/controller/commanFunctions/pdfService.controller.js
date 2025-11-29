const PDFDocument = require("pdfkit");
const fs = require("fs-extra");
const path = require("path");
const fetch = require("node-fetch");
const { getSchemaModels } = require("./schemaModels.controller");

async function loadTemplateFromDB(schema, clientId, type = 'Invoice') {
  const { template_masters } = getSchemaModels(schema);
  const template = await template_masters.findOne({ where: { client_id: clientId, type } });
  if (!template) throw new Error(`Template for clientId '${clientId}' not found`);
  return template.toJSON(); // Convert Sequelize instance to plain object
}

async function fetchImageBuffer(src) {
  if (!src) return null;
  try {
    if (/^https?:\/\//i.test(src)) {
      const r = await fetch(src);
      if (!r.ok) throw new Error("Failed fetching image");
      return await r.buffer();
    } else {
      const localPath = path.isAbsolute(src) ? src : path.join(process.cwd(), src);
      if (await fs.pathExists(localPath)) return await fs.readFile(localPath);
      return null;
    }
  } catch (err) {
    console.warn("fetchImageBuffer:", err.message);
    return null;
  }
}

function drawTable(doc, items, startX, startY, columnWidths, rowHeight, styles) {
  let y = startY;
  doc.fontSize(styles.tableHeaderFontSize || 10).font("Helvetica-Bold");
  const headers = ["#", "Description", "Qty", "Rate", "Amount"];
  let x = startX;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], x + 2, y + 4, { width: columnWidths[i] - 4 });
    x += columnWidths[i];
  }
  y += rowHeight;

  doc.font("Helvetica").fontSize(styles.tableRowFontSize || 10);
  items.forEach((it, idx) => {
    x = startX;
    const row = [
      idx + 1,
      it.description || it.name || "",
      it.quantity || 1,
      (it.rate || 0).toFixed(2),
      ((it.quantity || 1) * (it.rate || 0)).toFixed(2)
    ];
    for (let i = 0; i < row.length; i++) {
      doc.text(String(row[i]), x + 2, y + 4, { width: columnWidths[i] - 4 });
      x += columnWidths[i];
    }
    y += rowHeight;
    if (y + rowHeight > doc.page.height - 80) {
      doc.addPage();
      y = 50;
    }
  });

  return y;
}

async function generatePdf(invoiceData, schema, clientId, type) {
  const template = await loadTemplateFromDB(schema, clientId, type);
  const doc = new PDFDocument({ size: template.page_size || "A4", margin: template.margins || 40 });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));
  const endPromise = new Promise((resolve) => doc.on("end", () => resolve()));

  let logoBuf = null;
  if (template.logo_url) logoBuf = await fetchImageBuffer(template.logo_url);

  if (logoBuf) {
    try {
      doc.image(logoBuf, template.logo_options?.x || 40, template.logo_options?.y || 40, { width: template.logo_options?.width || 100 });
    } catch (e) {
      console.warn("logo draw failed", e.message);
    }
  }

  const headerRightX = doc.page.width - doc.page.margins.right - 250;
  doc.fontSize(template.header_company_font_size || 16).font("Helvetica-Bold");
  doc.text(template.company_name || invoiceData.companyName || "", headerRightX, 50, { align: "right" });
  doc.moveDown(0.2);
  doc.fontSize(template.header_small_font_size || 10).font("Helvetica");
  const address = template.address ? JSON.parse(template.address) : invoiceData.companyAddress || [];
  doc.text(address.join("\n"), { align: "right" });

  const metaY = 130;
  doc.fontSize(12).font("Helvetica-Bold").text("Invoice", 40, metaY);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Invoice #: ${invoiceData.invoiceNumber || ""}`, 40, metaY + 18);
  doc.text(`Date: ${invoiceData.date || ""}`, 40, metaY + 34);

  doc.font("Helvetica-Bold").text("Bill To:", 300, metaY);
  doc.font("Helvetica").fontSize(10);
  const billTo = invoiceData.billTo || {};
  const billLines = [billTo.name, billTo.address, billTo.city && (billTo.city + (billTo.pin ? " - " + billTo.pin : ""))].filter(Boolean);
  doc.text(billLines.join("\n"), 300, metaY + 18, { align: "left" });

  const tableStartY = 200;
  const columnWidths = [40, 260, 60, 80, 80];
  const rowHeight = 26;
  const afterTableY = drawTable(doc, invoiceData.items || [], 40, tableStartY, columnWidths, rowHeight, template.styles || {});

  const totalsX = 40 + columnWidths.slice(0, 3).reduce((a, b) => a + b, 0);
  let totalsY = Math.max(afterTableY + 10, tableStartY + 100);
  doc.font("Helvetica-Bold").fontSize(10);
  const subTotal = (invoiceData.items || []).reduce((s, it) => s + ((it.quantity || 1) * (it.rate || 0)), 0);
  doc.text(`Sub Total:`, totalsX, totalsY, { width: 160, align: "left" });
  doc.text(subTotal.toFixed(2), totalsX + 120, totalsY, { width: 80, align: "right" });
  totalsY += 18;
  const tax = invoiceData.tax || 0;
  doc.text(`Tax:`, totalsX, totalsY, { width: 160, align: "left" });
  doc.text((tax).toFixed(2), totalsX + 120, totalsY, { width: 80, align: "right" });
  totalsY += 18;
  const total = subTotal + tax - (invoiceData.discount || 0);
  doc.text(`Total:`, totalsX, totalsY, { width: 160, align: "left" });
  doc.text(total.toFixed(2), totalsX + 120, totalsY, { width: 80, align: "right" });

  doc.fontSize(9).font("Helvetica");
  if (invoiceData.notes || template.notes) {
    doc.text(`Notes: ${invoiceData.notes || template.notes}`, 40, doc.page.height - 100, { width: doc.page.width - 80 });
  }

  doc.end();
  await endPromise;
  return Buffer.concat(chunks);
};


async function generateInvoicePdf(req, res) {
  try {
    const { schema, clientId, type = 'Invoice' } = req.body;
    const invoiceData = req.body.invoice;

    const pdfBuffer = await generatePdf(invoiceData, schema, clientId, type);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename=invoice-${invoiceData.invoiceNumber || "invoice"}.pdf`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Error generating invoice PDF:", error);
    res.status(500).json({ error: error.message });
  }
}

module.exports = { generateInvoicePdf };
