const pdf = require('html-pdf');

/**
 * Generates a PDF from HTML content.
 * @param {string} htmlContent - The HTML content to convert to PDF.
 * @param {string} filename - The name of the PDF file (optional).
 * @param {object} options - Additional options for PDF generation (optional).
 * @returns {Promise<Buffer>} - A promise that resolves with the PDF buffer.
 */
const generatePDF = (htmlContent, filename = 'document.pdf', options = {}) => {
  return new Promise((resolve, reject) => {
    // Default options for PDF generation
    const defaultOptions = {
      format: 'A4',
      border: '10mm',
      ...options, // Merge user-provided options with defaults
    };

    // Generate the PDF
    pdf.create(htmlContent, defaultOptions).toBuffer((err, buffer) => {
      if (err) {
        reject(new Error('Failed to generate PDF'));
      } else {
        resolve(buffer);
      }
    });
  });
};

module.exports = { generatePDF };