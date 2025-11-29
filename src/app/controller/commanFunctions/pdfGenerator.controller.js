const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { getSchemaModels } = require('./schemaModels.controller');
const { ToWords } = require('to-words');
const EInvoiceQRCodeGenerator = require('./../invoice/qr_code_generator'); // adjust path

const toWords = new ToWords({
    localeCode: 'en-IN', // For Indian Rupees format
    converterOptions: {
        currency: true,
        ignoreDecimal: false,
        ignoreZeroCurrency: false,
    }
});

// // Initialize once at startup
// let browser;
// (async () => {
//     browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });
// })();

async function findOutOrganizationBasedOnSchema(params) {
    // send schema name and find out organization id from admin config
    const { organizations, schema } = params;
    const adminOrganizations = await organizations.findOne({
        where: { schema_name: schema, is_active: 'Active' }
    });
    if (!adminOrganizations) throw new Error('Admin Organizations not found');
    return adminOrganizations?.id;
}

async function generateQuotationPDF(organizationId, transaction_id, quotationData, schema, quotation_id) {
    try {
        if (!quotation_id) throw new Error('Quotation ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const { organization_masters, quotations, enquiries, client_masters, branch_masters, quotation_items, item_category_masters, item_masters, tax_masters } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // send schema name and find out organization id from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id: transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch quotation data using Sequelize query
        const quotationData = await quotations.findOne({
            where: { id: quotation_id },
            include: [
                {
                    model: branch_masters,
                    as: "branch"
                },
                {
                    model: enquiries,
                    as: "enquiry",
                    include: [
                        {
                            model: client_masters,
                            as: "customer"
                        }
                    ]
                },
                {
                    model: quotation_items,
                    as: "quotation_items",
                    include: [
                        {
                            model: quotations,
                            as: "quotation"
                        },
                        {
                            model: item_category_masters,
                            as: "itemCategory"
                        },
                        {
                            model: item_masters,
                            as: "item"
                        },
                        {
                            model: tax_masters,
                            as: "tax"
                        }
                    ]
                }
            ]
        });

        if (!quotationData) {
            throw new Error('Quotation not found');
        }

        const enquiryDetails = quotationData.enquiry_details;
        const customer = enquiryDetails.customer;
        const branch = quotationData.branch;
        const client = quotationData?.enquiry?.customer;

        const baseUrl = process.env.BASE_URL || 'https://tmpmsapi.disctesting.in/';

        const referenceDocument = enquiryDetails.references?.length
            ? enquiryDetails.references
                .map(ref => `<img src="${baseUrl}${ref.path}" alt="${ref.title}" style="max-width:100px; max-height:100px; margin-right:5px;" />`)
                .join('')
            : 'NA';


        // Transform API data to template format
        const mergedData = {
            company: {
                logo: organization.logo_url,
                name: organization.organization_name,
                pan: organization.pan_number,
                cin: organization.cin_number || 'N/A',
                gst: organization.gst_number,
                address: organization.address,
                phone: organization.phone_number,
                email: organization.email || ''
            },
            quotation: {
                number: quotationData.quotation_no,
                date: formatDateIndian(quotationData.quotation_date),
                deliveryDate: formatDateIndian(quotationData.delivery_date),
                createdAt: formatDateTimeIndian(quotationData.createdAt),
                updatedAt: formatDateTimeIndian(quotationData.updatedAt),
                notes: quotationData.notes || 'N/A'
            },
            enquiry: {
                number: enquiryDetails.enquiry_no,
                customerName: enquiryDetails.customer_name || 'N/A',
                customerContact: enquiryDetails.customer_contact,
                emailId: enquiryDetails.email_id,
                date: formatDateIndian(enquiryDetails.enquiry_date),
                source: enquiryDetails.source || 'N/A',
                referenceDocument,
                notes: ''
            },
            branch: {
                name: branch?.branch_name || 'N/A'
            },
            client: {
                // Additional client information
                companyName: client?.client_name || 'N/A',
                contactPerson: client?.contact_person_name || 'N/A',
                address: client?.address || 'N/A',
                phone: client?.phone_number || 'N/A',
                email: client?.email_id || 'N/A',
                gstNumber: client?.GSTIN_number || 'N/A'
            }
        };

        // Process quotation items
        const items = await Promise.all(quotationData.quotation_items.map(async quotationItem => {
            const item = quotationItem.item_details || quotationItem.item;
            const category = quotationItem.itemCategory;
            const tax = quotationItem.tax;

            // ✅ Fetch UOM from uom_masters
            let uomName = 'N/A';
            if (item.uom_id) {
                const uomRecord = await Models.uom_masters.findOne({ where: { id: item.uom_id } });
                if (uomRecord) {
                    uomName = uomRecord.name;
                }
            }

            return {
                category: category?.item_category_name || 'N/A',
                name: item?.item_name || 'N/A',
                drawingNo: item?.drawing_no || 'N/A',
                material: item?.material?.name || 'N/A',
                size: item?.size || 'N/A',
                description: item?.description || 'N/A',
                quantity: quotationItem.quantity.toString(),
                unitRate: parseFloat(quotationItem.unit_price).toFixed(2),
                taxPercentage: tax?.tax_percentage || '0',
                totalAmount: parseFloat(quotationItem.total_price).toFixed(2),
                hsnCode: item?.hsn_code || 'N/A',
                itemCode: item?.item_code || 'N/A',
                uom: uomName // ✅ Add UOM to item object
            };
        }));


        // Precompute dynamic items rows
        const itemsRows = items
            .map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.itemCode}</td>
                    <td>${item.name}</td>
                    <td>${item.quantity}</td>
                    <td>${item.uom}</td>
                    <td>${item.unitRate}</td>
                    <td>${item.taxPercentage}%</td>
                    <td>${item.totalAmount}</td>
                </tr>
            `).join('');

        // Calculate totals
        const totalQuantity = items
            .reduce((sum, item) => sum + parseFloat(item.quantity), 0)
            .toFixed(0);

        const totalUnitRate = items
            .reduce((sum, item) => sum + parseFloat(item.unitRate), 0)
            .toFixed(2);

        const totalTaxPercentage = items
            .reduce((sum, item) => sum + parseFloat(item.taxPercentage), 0)
            .toFixed(2);

        let totalAmount = items
            .reduce((sum, item) => sum + parseFloat(item.totalAmount), 0);

        // Calculate summary values
        const subTotal = items
            .reduce((sum, item) => sum + (parseFloat(item.quantity) * parseFloat(item.unitRate)), 0)
            .toFixed(2);

        const taxAmount = items
            .reduce((sum, item) => {
                const itemSubTotal = parseFloat(item.quantity) * parseFloat(item.unitRate);
                const itemTaxAmount = (itemSubTotal * parseFloat(item.taxPercentage)) / 100;
                return sum + itemTaxAmount;
            }, 0)
            .toFixed(2);

        totalAmount = Math.round(totalAmount); // Round to nearest whole number
        const amountInWords = toWords.convert(Number(totalAmount), { currency: true });

        mergedData.items = items;
        mergedData.itemsRows = itemsRows;
        mergedData.totalQuantity = totalQuantity;
        mergedData.totalUnitRate = totalUnitRate;
        mergedData.totalTaxPercentage = totalTaxPercentage;
        mergedData.totalAmount = totalAmount;
        mergedData.amountInWords = amountInWords.charAt(0).toUpperCase() + amountInWords.slice(1);

        // Add summary data
        mergedData.summary = {
            subTotal: subTotal,
            taxAmount: taxAmount,
            totalAmount: totalAmount,
            amountInWords
        };

        // Replace placeholders
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined ? value : match;
        });

        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });

        const page = await browser.newPage();
        // await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', reject);
                });
            }));
        });


        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        await page.close();
        await browser.close();
        return pdfBuffer;  // return buffer
    } catch (error) {
        console.error('Error generating Quotation PDF:', error);
        throw error;
    }
}

async function generatePOPDF(organizationId, transaction_id, poData, schema, po_id) {
    try {
        if (!po_id) throw new Error('PO ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const { organization_masters, term_and_condition_masters, state_masters, pos, branch_masters, prs, supplier_vendor_masters, user_masters, po_items, item_category_masters, item_boms, item_masters, uom_masters, tax_masters } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');


        // send schema name and find out organization id from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch PO data using Sequelize query
        const poData = await pos.findOne({
            where: { id: po_id },
            include: [
                {
                    model: branch_masters,
                    as: "branch",
                    required: true
                },
                {
                    model: prs,
                    as: "pr"
                },
                {
                    model: supplier_vendor_masters,
                    as: "supplier"
                },
                {
                    model: user_masters,
                    as: "createdBy"
                },
                {
                    model: user_masters,
                    as: "updatedBy"
                },
                {
                    model: po_items,
                    as: "items",
                    include: [
                        {
                            model: item_category_masters,
                            as: "item_category"
                        },
                        {
                            model: item_boms,
                            as: "itemBom",
                            include: [
                                {
                                    model: item_masters,
                                    as: "item"
                                },
                                {
                                    model: item_masters,
                                    as: "bomItem",
                                    include: [
                                        {
                                            model: uom_masters,
                                            as: "purchaseUom"
                                        }
                                    ]
                                },
                                {
                                    model: uom_masters,
                                    as: "uom"
                                }
                            ]
                        },
                        {
                            model: uom_masters,
                            as: "uom"
                        },
                        {
                            model: tax_masters,
                            as: "tax"
                        }
                    ]
                }
            ]
        });

        if (!poData) {
            throw new Error('Purchase Order not found');
        }

        // const termsAndConditions = await term_and_condition_masters.findAll({
        //     where: {
        //         // organization_id: organizationId,
        //         // branch_id: poData.branch.id,
        //         is_active: 'Active'
        //     },
        //     order: [['createdAt', 'ASC']]
        // });

        // Update terms and conditions - use from pos table instead of term_and_condition_masters
        let termsHtml = '';
        if (schema === 'bolzen' && poData.terms_and_conditions) {
            const terms = poData.terms_and_conditions.split('\n').filter(t => t.trim());
            termsHtml = `
        <ul style="list-style-type:none; padding-left:0; margin:0;">
            ${terms.map(term => `<li>${term.trim()}</li>`).join('')}
        </ul>`;
        }



        const supplier = poData.supplier;
        const branch = poData.branch;
        const pr = poData.pr;
        const createdBy = poData.createdBy;

        const baseUrl = process.env.BASE_URL || 'https://tmpmsapi.disctesting.in/';

        // Transform API data to template format
        const mergedData = {
            company: {
                logo: organization.logo_url,
                name: organization.organization_name,
                pan: organization.pan_number,
                cin: organization.cin_number || 'N/A',
                gst: organization.gst_number,
                address: organization.address,
                phone: organization.phone_number,
                email: organization.email || ''
            },
            po: {
                number: poData.po_number,
                date: formatDateIndian(poData.po_date),
                status: poData.status,
                gstNo: poData.gst_no || 'N/A',
                deliveryAddress: poData.delivery_address || 'N/A',
                remark: poData.remark || '',
                createdAt: formatDateTimeIndian(poData.createdAt),
                updatedAt: formatDateTimeIndian(poData.updatedAt)
            },
            pr: {
                number: pr?.pr_number || 'N/A',
                status: pr?.status || 'N/A'
            },
            supplier: {
                companyName: supplier?.company_name || 'N/A',
                referenceName: supplier?.reference_name || 'N/A',
                referenceCode: supplier?.reference_code || 'N/A',
                primaryContactPerson: supplier?.primary_contact_person || 'N/A',
                primaryContactNumber: supplier?.primary_contact_number || 'N/A',
                primaryContactEmail: supplier?.primary_contact_email || 'N/A',
                gstNumber: supplier?.gst_number || 'N/A',
                panNumber: supplier?.pan_number || 'N/A',
                address: supplier?.address || 'N/A',
                pincode: supplier?.pincode || 'N/A'
            },
            branch: {
                name: branch?.branch_name || 'N/A',
                address: branch?.address || ''
            },
            createdBy: {
                name: createdBy ? `${createdBy.first_name} ${createdBy.last_name}` : 'N/A',
                email: createdBy?.email_id || 'N/A'
            }
        };

        // Determine tax type
        const isSameState = (organization.state_id == supplier.state_id) || !supplier.state_id || !organization.state_id;

        // Process PO items
        let items = poData.items.map(poItem => {
            const itemBom = poItem.itemBom;
            const bomItem = itemBom?.bomItem;
            const category = poItem.item_category;
            const tax = poItem.tax;
            const uom = poItem.uom;

            // Check if item is amended and use amended values if available
            let orderQty = poItem.is_amended ? (poItem.amended_qty || poItem.order_qty) : poItem.order_qty;
            orderQty = parseFloat(Number(orderQty).toFixed(2));
            const rate = poItem.is_amended ? (poItem.amended_rate || poItem.rate) : poItem.rate;

            // Calculate item subtotal before tax
            // const subtotal = parseFloat(poItem.order_qty) * parseFloat(poItem.rate);
            const subtotal = parseFloat(orderQty) * parseFloat(rate);
            const discountAmount = parseFloat(poItem.discount_amount) || 0;
            const subtotalAfterDiscount = subtotal - discountAmount;

            const taxPercentage = parseFloat(tax?.tax_percentage || 0);
            const taxAmount = (subtotalAfterDiscount * taxPercentage) / 100;
            const totalAmount = subtotalAfterDiscount + taxAmount;

            return {
                category: category?.item_category_name || 'N/A',
                name: bomItem?.item_name || itemBom?.bom_name || 'N/A',
                itemCode: bomItem?.item_code || itemBom?.item_code || 'N/A',
                hsnCode: bomItem?.hsn_code || itemBom?.hsn_code || 'N/A',
                drawingNo: bomItem?.drawing_no || 'N/A',
                material: bomItem?.material || 'N/A',
                size: bomItem?.size || itemBom?.size || 'N/A',
                description: bomItem?.description || itemBom?.description || 'N/A',
                orderQty: Number(orderQty).toFixed(2).toString(),
                receivedQty: poItem.received_qty.toString(),
                rate: parseFloat(rate).toFixed(2),
                uom: uom?.name || 'N/A',
                discountAmount: discountAmount.toFixed(2),
                taxPercentage: tax?.tax_percentage || '0',
                totalAmount: totalAmount.toFixed(2) || parseFloat(poItem.total_amount).toFixed(2),
                expectedDeliveryDate: formatDateIndian(poItem.expected_delivery_date),
                status: poItem.status,
                subtotal: subtotal.toFixed(2),
                subtotalAfterDiscount: subtotalAfterDiscount.toFixed(2),
                taxAmount: taxAmount.toFixed(2)
            };
        });

        let totalAmount = 0; // initialize total
        let subTotal = 0;
        let totalDiscount = 0;
        let totalTaxAmount = 0;
        let grandTotal = 0;
        let totalOrderQty = 0;

        // After tax calculations and before mergedData.summary
        let deliveryCharges = parseFloat(poData.delivery_charges) || 0;
        let transportCharges = parseFloat(poData.transport_charges) || 0;
        let freightCharges = parseFloat(poData.freight_charges) || 0;
        let otherCharges = parseFloat(poData.other_charges) || 0;

        // Get tax rate from first item (if available)
        const firstItemTaxRate = items.length > 0 ? parseFloat(items[0].taxPercentage) || 0 : 0;

        // Calculate tax on additional charges
        let deliveryChargesTax = 0;
        let transportChargesTax = 0;
        let freightChargesTax = 0;
        let otherChargesTax = 0;

        if (firstItemTaxRate > 0) {
            deliveryChargesTax = (deliveryCharges * firstItemTaxRate) / 100;
            transportChargesTax = (transportCharges * firstItemTaxRate) / 100;
            freightChargesTax = (freightCharges * firstItemTaxRate) / 100;
            otherChargesTax = (otherCharges * firstItemTaxRate) / 100;
        }

        // Update total tax amount to include taxes on additional charges
        const additionalCharges = deliveryCharges + transportCharges + freightCharges + otherCharges;
        const additionalChargesTax = additionalCharges * firstItemTaxRate / 100;

        // Round off to 2 decimal places
        totalTaxAmount = parseFloat(additionalChargesTax.toFixed(2));
        grandTotal = parseFloat(additionalChargesTax.toFixed(2));

        let additionalChargesRows = '';
        if (schema === 'bolzen') {
            if (deliveryCharges > 0) {
                additionalChargesRows += `
            <tr>
                <td>Delivery Charges :</td>
                <td>₹${deliveryCharges.toFixed(2)}</td>
            </tr>
        `;
                grandTotal += deliveryCharges;
            }
            if (transportCharges > 0) {
                additionalChargesRows += `
            <tr>
                <td>Transport Charges :</td>
                <td>₹${transportCharges.toFixed(2)}</td>
            </tr>
        `;
                grandTotal += transportCharges;
            }
            if (freightCharges > 0) {
                additionalChargesRows += `
            <tr>
                <td>Freight Charges :</td>
                <td>₹${freightCharges.toFixed(2)}</td>
            </tr>
        `;
                grandTotal += freightCharges;
            }
            if (otherCharges > 0) {
                additionalChargesRows += `
            <tr>
                <td>Other Charges :</td>
                <td>₹${otherCharges.toFixed(2)}</td>
            </tr>
        `;
                grandTotal += otherCharges;
            }
        }

        mergedData.additionalChargesRows = additionalChargesRows;

        // Precompute dynamic items rows
        const itemsRows = items
            .map((item, index) => {
                const orderQty = item.orderQty || 0;
                const rate = Number(item.rate) || 0;
                const discountPercentage = Number(item.discountAmount) || 0; // discount in %
                const taxPercentage = Number(item.taxPercentage) || 0; // tax in %

                // 💡 Step 1: Base price
                const itemSubTotal = Number((orderQty * rate).toFixed(2));

                // 💡 Step 2: Discount amount
                const itemDiscount = Number((itemSubTotal * (discountPercentage / 100)).toFixed(2));

                // 💡 Step 3: Amount after discount
                const afterDiscount = itemSubTotal - itemDiscount;

                // 💡 Step 4: Tax amount (on discounted price)
                const itemTax = afterDiscount * (taxPercentage / 100);

                // 💡 Step 5: Final item total
                const itemTotal = afterDiscount + itemTax;

                // 🔹 Accumulate totals
                subTotal += itemSubTotal;
                totalDiscount += itemDiscount;
                totalTaxAmount += itemTax;
                grandTotal += itemTotal;
                totalOrderQty += Number(orderQty);
                totalAmount += afterDiscount;

                if (schema === 'bolzen') {
                    return `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${item.itemCode}</td>
                                <td>${item.name}</td>
                                <td>${item.hsnCode}</td>
                                <td>${orderQty}</td>
                                <td>${item.uom}</td>
                                <td>${rate}</td>
                                <td>${discountPercentage}%</td>
                                <td>${item.taxPercentage}%</td>
                                <td>${afterDiscount.toFixed(2)}</td>
                                <td>${item.expectedDeliveryDate}</td>
                            </tr>
                    `;
                }
                else {
                    // New format: S No, Material Code, Item Description, Unit, Qty, Rate, Disc%, Amount, Remarks
                    return `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${item.itemCode}</td>
                                <td>${item.hsnCode}</td>
                                <td>${item.name}</td>
                                <td>${item.uom}</td>
                                <td>${orderQty}</td>
                                <td>${rate.toFixed(2)}</td>
                                <td>${discountPercentage}%</td>
                                <td>${afterDiscount.toFixed(2)}</td>
                                <td></td>
                            </tr>
                    `;
                }
            })
            .join('');

        // Generate tax summary rows based on state matching
        let taxSummaryRows = '';
        const avgTaxPercentage = items.length > 0
            ? (items.reduce((sum, item) => sum + parseFloat(item.taxPercentage), 0) / items.length).toFixed(2)
            : '0.00';

        if (isSameState) {
            // Same state - show CGST and SGST
            const cgstAmount = (parseFloat(totalTaxAmount) / 2).toFixed(2);
            const sgstAmount = (parseFloat(totalTaxAmount) / 2).toFixed(2);
            const cgstRate = (parseFloat(avgTaxPercentage) / 2).toFixed(2);
            const sgstRate = (parseFloat(avgTaxPercentage) / 2).toFixed(2);

            taxSummaryRows = `
                <tr>
                    <td>CGST (${cgstRate}%) :</td>
                    <td>₹${cgstAmount}</td>
                </tr>
                <tr>
                    <td>SGST (${sgstRate}%) :</td>
                    <td>₹${sgstAmount}</td>
                </tr>
            `;
        } else {
            // Different state - show IGST
            taxSummaryRows = `
                <tr>
                    <td>IGST (${avgTaxPercentage}%) :</td>
                    <td>₹${totalTaxAmount}</td>
                </tr>
            `;
        }

        mergedData.items = items;
        mergedData.itemsRows = itemsRows;
        mergedData.totalOrderQty = totalOrderQty;
        mergedData.totalRate = 0;
        mergedData.totalDiscountAmount = totalDiscount;
        mergedData.totalTaxPercentage = totalTaxAmount;
        mergedData.totalAmount = totalAmount;
        mergedData.termsAndConditions = termsHtml;
        mergedData.taxSummaryRows = taxSummaryRows;

        grandTotal = Math.round(grandTotal);

        const amountInWords = toWords.convert(Number(parseFloat(grandTotal || 0).toFixed(2)), { currency: true });

        // Add summary data...
        mergedData.summary = {
            subTotal: Number(subTotal).toFixed(2),
            totalDiscount: totalDiscount,
            taxAmount: totalTaxAmount,
            grandTotal: grandTotal,
            amountInWords: amountInWords
        };

        // Replace placeholders
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined ? value : match;
        });

        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });

        const page = await browser.newPage();
        // await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', reject);
                });
            }));
        });


        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        await page.close();
        await browser.close();
        return pdfBuffer;  // return buffer
    } catch (error) {
        console.error('Error generating PO PDF:', error);
        throw error;
    }
}

async function generatePOInwardPDF(organizationId, transaction_id, inwardData, schema, po_inward_id) {
    try {
        if (!po_inward_id) throw new Error('Inward ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;

        const { organization_masters, inwards, branch_masters, tax_masters, supplier_vendor_masters, warehouse_masters, user_masters, inward_items, pos, po_items, item_category_masters, item_boms, uom_masters } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // send schema name and find out organization id from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');


        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch Inward data using Sequelize query
        const inwardData = await inwards.findOne({
            where: { id: po_inward_id },
            include: [
                {
                    model: organization_masters,
                    as: "organization"
                },
                {
                    model: branch_masters,
                    as: "branch"
                },
                {
                    model: supplier_vendor_masters,
                    as: "supplier"
                },
                {
                    model: warehouse_masters,
                    as: "warehouse"
                },
                {
                    model: user_masters,
                    as: "createdBy"
                },
                {
                    model: user_masters,
                    as: "updatedBy"
                },
                {
                    model: inward_items,
                    as: "items",
                    include: [
                        {
                            model: pos,
                            as: "po"
                        },
                        {
                            model: po_items,
                            as: "poItem",
                            include: [
                                {
                                    model: tax_masters,
                                    as: "tax"
                                }
                            ]
                        },
                        {
                            model: item_category_masters,
                            as: "category"
                        },
                        {
                            model: item_boms,
                            as: "item"
                        },
                        {
                            model: uom_masters,
                            as: "uom"
                        }
                    ]
                }
            ]
        });

        if (!inwardData) {
            throw new Error('Inward not found');
        }

        const supplier = inwardData.supplier;
        const branch = inwardData.branch;
        const warehouse = inwardData.warehouse;
        const createdBy = inwardData.createdBy;

        const baseUrl = process.env.BASE_URL || 'https://tmpmsapi.disctesting.in/';

        const amount = Math.round(parseFloat(inwardData.bill_amount || 0));

        let amountInWords = toWords.convert(amount, { currency: true });

        // Transform API data to template format
        const mergedData = {
            company: {
                logo: organization.logo_url,
                name: organization.organization_name,
                pan: organization.pan_number,
                cin: organization.cin_number || 'N/A',
                gst: organization.gst_number,
                address: organization.address,
                phone: organization.phone_number,
                email: organization.email || ''
            },
            inward: {
                grnNumber: inwardData.grn_number,
                grnDate: formatDateIndian(inwardData.grn_date),
                status: inwardData.status,
                receiverName: inwardData.receiver_name || 'N/A',
                vehicleNumber: inwardData.vehicle_number || 'N/A',
                driverName: inwardData.driver_name || 'N/A',
                materialReceivedDate: formatDateIndian(inwardData.material_received_date),
                billNo: inwardData.bill_no || 'N/A',
                billDate: formatDateIndian(inwardData.bill_date),
                extraCharges: parseFloat(inwardData.extra_charges || 0).toFixed(2),
                billAmount: amount || 0,
                amountInWords: amountInWords,
                dcNumber: inwardData.dc_number || 'N/A',
                dcDate: formatDateIndian(inwardData.dc_date),
                remark: inwardData.remark || '',
                createdAt: formatDateTimeIndian(inwardData.createdAt),
                updatedAt: formatDateTimeIndian(inwardData.updatedAt)
            },
            supplier: {
                companyName: supplier?.company_name || 'N/A',
                referenceName: supplier?.reference_name || 'N/A',
                referenceCode: supplier?.reference_code || 'N/A',
                primaryContactPerson: supplier?.primary_contact_person || 'N/A',
                primaryContactNumber: supplier?.primary_contact_number || 'N/A',
                primaryContactEmail: supplier?.primary_contact_email || 'N/A',
                gstNumber: supplier?.gst_number || 'N/A',
                panNumber: supplier?.pan_number || 'N/A',
                address: supplier?.address || 'N/A',
                pincode: supplier?.pincode || 'N/A'
            },
            branch: {
                name: branch?.branch_name || 'N/A'
            },
            warehouse: {
                name: warehouse?.warehouse_name || 'N/A'
            },
            createdBy: {
                name: createdBy ? `${createdBy.first_name} ${createdBy.last_name}` : 'N/A',
                email: createdBy?.email_id || 'N/A'
            }
        };

        // Process Inward items
        const items = inwardData.items.map(inwardItem => {
            const item = inwardItem.item;
            const category = inwardItem.category;
            const uom = inwardItem.uom;
            const po = inwardItem.po;
            const poItem = inwardItem.poItem;
            const tax = poItem?.tax;

            const receivedQty = parseFloat(inwardItem.received_qty) || 0;
            const rate = parseFloat(inwardItem.rate) || 0;
            const orderQty = parseFloat(inwardItem.order_qty) || 0;

            // Calculate proportional discount for received quantity
            const totalDiscountPercentage = parseFloat(poItem?.discount_amount) || 0;
            const itemDiscount = (receivedQty * rate * totalDiscountPercentage) / 100;


            // Calculate item amount after discount
            const amountBeforeDiscount = receivedQty * rate;
            const amount = amountBeforeDiscount - itemDiscount;

            // Calculate tax amount
            const taxPercentage = parseFloat(tax?.tax_percentage) || 0;
            const taxAmount = (amount * taxPercentage) / 100;

            const totalAmount = amount + taxAmount;

            // Calculate item amount
            // const amount = parseFloat(inwardItem.received_qty) * parseFloat(inwardItem.rate);

            return {
                category: category?.item_category_name || 'N/A',
                name: item?.bom_name || 'N/A',
                itemCode: item?.item_code || 'N/A',
                hsnCode: item?.hsn_code || 'N/A',
                size: item?.size || 'N/A',
                description: item?.description || 'N/A',
                orderQty: inwardItem?.order_qty || '0.000',
                receivedQty: inwardItem.received_qty.toString(),
                uom: uom?.name || 'N/A',
                rate: parseFloat(inwardItem.rate).toFixed(2),
                amount: totalAmount.toFixed(2),
                subTotal: amount.toFixed(2),
                poNumber: po?.po_number || 'N/A',
                remark: inwardItem.remark || '',
                taxPercentage: taxPercentage.toFixed(2),
                taxAmount: taxAmount.toFixed(2),
                discount: totalDiscountPercentage.toFixed(2)
            };
        });

        // Precompute dynamic items rows
        const itemsRows = items
            .map((item, index) => `
                <tr>
                    <td>${index + 1}</td>
                    <td>${item.itemCode}</td>
                    <td>${item.name}</td>
                    <td>${item.orderQty}</td>
                    <td>${item.receivedQty}</td>
                    <td>${item.uom}</td>
                    <td>${item.rate}</td>
                    <td>${item.discount}%</td>
                    <td>${item.taxPercentage}%</td>
                    <td>${item.amount}</td>
                </tr>
            `).join('');

        // Calculate totals
        const totalOrderQty = Math.round(
            items.reduce((sum, item) => sum + (parseInt(item.orderQty) || 0), 0)
        );

        const totalReceivedQty = Math.round(
            items.reduce((sum, item) => sum + (parseInt(item.receivedQty) || 0), 0)
        );

        const totalRate = items
            .reduce((sum, item) => sum + parseFloat(item.rate), 0)
            .toFixed(2);

        // Sub Total (after discount)
        const subTotal = items
            .reduce((sum, item) => sum + parseFloat(item.subTotal), 0);

        const amountWithDiscAndTax = items
            .reduce((sum, item) => sum + parseFloat(item.amount), 0);

        // Extra Charges
        const extraCharges = parseFloat(inwardData.extra_charges || 0);

        // Get first item tax rate for extra charges
        const firstItemTaxRate = items.length > 0 ? parseFloat(items[0].taxPercentage) : 0;

        // Calculate total tax (items tax + extra charges tax)
        const itemsTax = items.reduce((sum, item) => sum + parseFloat(item.taxAmount), 0);
        const extraChargesTax = (extraCharges * firstItemTaxRate) / 100;
        const totalTax = itemsTax + extraChargesTax;

        // Bill Amount
        const billAmount = Math.round(subTotal + extraCharges + totalTax);

        amountInWords = toWords.convert(billAmount, { currency: true });

        // const totalAmount = items
        //     .reduce((sum, item) => sum + parseFloat(item.amount), 0)
        //     .toFixed(2);

        mergedData.items = items;
        mergedData.amountWithDiscAndTax = amountWithDiscAndTax.toFixed(2);
        mergedData.itemsRows = itemsRows;
        mergedData.totalOrderQty = totalOrderQty;
        mergedData.totalReceivedQty = totalReceivedQty;
        mergedData.totalRate = totalRate;
        mergedData.totalItems = items.length;
        mergedData.subTotal = subTotal.toFixed(2);
        mergedData.totalTax = totalTax.toFixed(2);
        mergedData.billAmount = billAmount;
        mergedData.amountInWords = amountInWords;
        // mergedData.totalAmount = totalAmount;

        console.log(JSON.stringify(mergedData, null, 2));

        // Replace placeholders
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined ? value : match;
        });

        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });

        const page = await browser.newPage();
        // await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', reject);
                });
            }));
        });


        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        await page.close();
        await browser.close();
        return pdfBuffer;  // return buffer
    } catch (error) {
        console.error('Error generating Inward PDF:', error);
        throw error;
    }
}

async function generateJobWorkOutwardPDF(organizationId, transaction_id, outwardData, schema, jw_outward_id) {
    try {
        if (!jw_outward_id) throw new Error('Job Work Outward ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const { organization_masters, operation_masters, job_work_outwards, branch_masters, uom_masters, supplier_vendor_masters, user_masters, tax_masters, job_works, job_work_details, item_masters, state_masters } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // send schema name and find out organization id from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch Job Work Outward data using Sequelize query
        const outwardData = await job_work_outwards.findOne({
            where: { id: jw_outward_id },
            include: [
                {
                    model: job_works,
                    as: "job_work",
                    include: [
                        {
                            model: branch_masters,
                            as: "branch",
                            include: [
                                {
                                    model: state_masters,
                                    as: "state"
                                }
                            ]
                        },
                        {
                            model: supplier_vendor_masters,
                            as: "vendor",
                            include: [
                                {
                                    model: state_masters,
                                    as: "state"
                                }
                            ]
                        },
                        {
                            model: tax_masters,
                            as: "tax"
                        },
                        {
                            model: job_work_details,
                            as: "job_work_details",
                            include: [
                                {
                                    model: item_masters,
                                    as: "bom",
                                    include: [
                                        {
                                            model: uom_masters,
                                            as: 'uom'
                                        }
                                    ]
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!outwardData) {
            throw new Error('Job Work Outward not found');
        }

        const jobWork = outwardData.job_work;
        const branch = jobWork.branch;
        const vendor = jobWork.vendor;
        const tax = jobWork.tax;
        const jobWorkDetails = jobWork.job_work_details;

        // Check if vendor and organization are in same state
        const orgStateId = organization.state_id;
        const vendorStateId = vendor?.state_id;
        const isSameState = (orgStateId === vendorStateId) || !vendorStateId || !orgStateId;

        // Transform API data to template format
        const mergedData = {
            company: {
                logo: organization.logo_url,
                name: organization.organization_name,
                pan: organization.pan_number,
                cin: organization.cin_number || 'N/A',
                gst: organization.gst_number,
                address: organization.address,
                phone: organization.phone_number,
                email: organization.email || '',
                state: organization.state_name || ''
            },
            outward: {
                id: outwardData.id,
                vehicleNumber: outwardData.vehicle_number || '',
                transportMode: outwardData.transport_mode || '',
                driverName: outwardData.driver_name || '',
                status: outwardData.status || 'N/A',
                gateOutwardNo: outwardData.gate_outward_no || '',
                createdAt: formatDateIndian(outwardData.createdAt),
                updatedAt: formatDateTimeIndian(outwardData.updatedAt)
            },
            jobWork: {
                number: jobWork.job_work_number,
                date: formatDateIndian(jobWork.date),
                remarks: jobWork.remarks || 'N/A',
                vehicle_number: outwardData.vehicle_number || '',
                materialGrade: outwardData.material_grade || '',
                heatNo: outwardData.heat_no || '',
                remarks: jobWork.remarks || ''
            },
            vendor: {
                companyName: vendor?.company_name || '',
                referenceName: vendor?.reference_name || '',
                primaryContactPerson: vendor?.primary_contact_person || '',
                primaryContactNumber: vendor?.primary_contact_number || '',
                primaryContactEmail: vendor?.primary_contact_email || '',
                gstNumber: vendor?.gst_number || '',
                panNumber: vendor?.pan_number || '',
                address: vendor?.address || '',
                pincode: vendor?.pincode || '',
                state: vendor?.state?.state_name || ''
            },
            branch: {
                name: branch?.branch_name || 'N/A'
            },
            tax: {
                taxName: tax?.tax_name || '',
                taxPercentage: tax?.tax_percentage || ''
            },
            isSameState: isSameState
        };

        // Process outward items

        // Process outward items
        let items = await Promise.all(
            jobWorkDetails.map(async (item, index) => {
                const itemMaster = item.bom;
                const operationIds = item.operation_ids || [];

                // Fetch operation master records for given IDs
                const operations = await operation_masters.findAll({
                    where: { id: operationIds },
                    attributes: ['operation_name'],
                });

                // Extract only names into a string
                const operationNames = operations.length > 0
                    ? operations.map(op => op.operation_name).join(', ')
                    : 'N/A';


                const quantity = parseFloat(item.quantity || 0);
                const rate = parseFloat(item.rate || 0);
                const totalAmount = quantity * rate;
                const taxPercentage = parseFloat(tax?.tax_percentage || 0);
                const taxAmount = totalAmount * (taxPercentage / 100);

                return {
                    srNo: index + 1,
                    name: itemMaster?.item_name || '',
                    itemCode: itemMaster?.item_code || '',
                    hsnCode: itemMaster?.hsn_code || '',
                    size: itemMaster?.size || '',
                    description: itemMaster?.description || '',
                    batchNumber: item.batch_number || '',
                    quantity: quantity.toFixed(2),
                    rate: rate.toFixed(2),
                    totalAmount: totalAmount.toFixed(2),
                    taxAmount: taxAmount.toFixed(2),
                    operations: operationNames || '',
                    status: item.status || '',
                    uom: itemMaster?.uom?.name || ''
                };
            })
        );

        // Calculate totals
        const totalQuantity = items
            .reduce((sum, item) => sum + parseFloat(item.quantity), 0)
            .toFixed(2);

        const totalRate = items
            .reduce((sum, item) => sum + parseFloat(item.rate), 0)
            .toFixed(2);

        const totalAmount = items
            .reduce((sum, item) => sum + parseFloat(item.totalAmount), 0)
            .toFixed(2);

        const totalTaxAmount = items
            .reduce((sum, item) => sum + parseFloat(item.taxAmount), 0)
            .toFixed(2);

        const grandTotal = Math.round(parseFloat(totalAmount) + parseFloat(totalTaxAmount));

        let amountInWords = "";

        if (schema == 'bolzen') {
            amountInWords = toWords.convert(Number(grandTotal), { currency: true });
        }
        else {
            amountInWords = toWords.convert(Number(totalAmount), { currency: true });
        }


        // Generate tax summary based on state matching
        let taxSummaryRows = '';
        const taxPercentage = parseFloat(tax?.tax_percentage || 0);

        if (isSameState) {
            // Same state - show CGST and SGST
            taxSummaryRows = `
                <tr>
                    <td>Gross Amount :</td>
                    <td>₹${totalAmount}</td>
                </tr>
                <tr>
                    <td>CGST (${(taxPercentage / 2).toFixed(2)}%) :</td>
                    <td>₹${(totalTaxAmount / 2).toFixed(2)}</td>
                </tr>
                <tr>
                    <td>SGST (${(taxPercentage / 2).toFixed(2)}%) :</td>
                    <td>₹${(totalTaxAmount / 2).toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Net Amount :</td>
                    <td>₹${grandTotal}</td>
                </tr>
            `;
        } else {
            // Different state - show IGST
            taxSummaryRows = `
                <tr>
                    <td>Gross Amount :</td>
                    <td>₹${totalAmount}</td>
                </tr>
                <tr>
                    <td>IGST (${taxPercentage}%) :</td>
                    <td>₹${totalTaxAmount}</td>
                </tr>
                <tr>
                    <td>Net Amount :</td>
                    <td>₹${grandTotal}</td>
                </tr>
            `;
        }

        // Prepare items table rows
        // const itemsRows = items
        //     .map(item => `
        //         <tr>
        //             <td>${item.srNo}</td>
        //             <td>${item.name}</td>
        //             <td>${item.itemCode}</td>
        //             <td>${item.hsnCode}</td>
        //             <td>${item.quantity}</td>
        //             <td>${item.uom}</td>
        //             <td>${item.rate}</td>
        //             <td>${item.operations}</td>
        //             <td>${item.totalAmount}</td>
        //         </tr>
        //     `).join('');

        // CONDITIONAL ITEMS TABLE ROWS BASED ON SCHEMA
        let itemsRows = '';

        if (schema == 'bolzen') {
            // Bolzen schema - Delivery Challan format (9 columns)
            itemsRows = items
                .map(item => `
                    <tr>
                        <td>${item.srNo}</td>
                        <td>${item.name}</td>
                        <td>${item.itemCode}</td>
                        <td>${item.hsnCode}</td>
                        <td>${item.quantity}</td>
                        <td>${item.uom}</td>
                        <td>${item.rate}</td>
                        <td>${item.operations}</td>
                        <td>${item.totalAmount}</td>
                    </tr>
                `).join('');
        } else {
            itemsRows = items
                .map(item => `
                    <tr>
                        <td style="text-align: center;">${item.srNo}</td>
                        <td>${item.itemCode}</td>
                        <td>${item.name}</td>
                        <td style="text-align: center;">${item.hsnCode}</td>
                        <td style="text-align: center;">${item.uom}</td>
                        <td style="text-align: right;">${item.quantity}</td>
                        <td style="text-align: right;">${item.rate}</td>
                        <td style="text-align: right;">${item.totalAmount}</td>
                        <td>${item.operations}</td>
                    </tr>
                `).join('');
        }

        mergedData.items = items;
        mergedData.itemsRows = itemsRows;
        mergedData.totalQuantity = totalQuantity;
        mergedData.totalRate = totalRate;
        mergedData.totalAmount = totalAmount;
        mergedData.totalTaxAmount = totalTaxAmount;
        mergedData.totalItems = items.length;
        mergedData.grandTotal = grandTotal;
        mergedData.amountInWords = amountInWords;
        mergedData.taxSummaryRows = taxSummaryRows;
        mergedData.taxPercentage = taxPercentage;

        // Replace placeholders in template
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined ? value : match;
        });

        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', reject);
                });
            }));
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });

        await page.close();
        await browser.close();
        return pdfBuffer;
    } catch (error) {
        console.error('Error generating Job Work Outward PDF:', error);
        throw error;
    }
}

async function generateJobWorkInwardPDF(organizationId, transaction_id, data, schema, inward_id) {
    try {
        if (!inward_id) throw new Error('Job Work Inward ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const { organization_masters, job_work_inwards, branch_masters, tax_masters, uom_masters, supplier_vendor_masters, job_works, job_work_inward_details, item_masters, job_work_details } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // send schema name and find out organization id from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch Job Work Inward data using Sequelize query
        const inwardData = await job_work_inwards.findOne({
            where: { id: inward_id },
            include: [
                {
                    model: branch_masters,
                    as: "branch"
                },
                {
                    model: supplier_vendor_masters,
                    as: "vendor"
                },
                {
                    model: job_works,
                    as: "job_work",
                    include: [
                        {
                            model: job_work_details,
                            as: "job_work_details",
                            include: [
                                {
                                    model: item_masters,
                                    as: "bom"
                                }
                            ]
                        }
                    ]
                },
                {
                    model: job_work_inward_details,
                    as: "job_work_inward_details",
                    include: [
                        {
                            model: item_masters,
                            as: "bom",
                            include: [
                                {
                                    model: uom_masters,
                                    as: "uom"
                                }
                            ]
                        }
                    ]
                }
            ]
        });

        if (!inwardData) {
            throw new Error('Job Work Inward not found');
        }

        const branch = inwardData.branch;
        const vendor = inwardData.vendor;
        const jobWork = inwardData.job_work;
        const inwardDetails = inwardData.job_work_inward_details;

        // Transform API data to template format
        const mergedData = {
            company: {
                logo: organization.logo_url,
                name: organization.organization_name,
                pan: organization.pan_number,
                cin: organization.cin_number || 'N/A',
                gst: organization.gst_number,
                address: organization.address,
                phone: organization.phone_number,
                email: organization.email || ''
            },
            inward: {
                grnNumber: inwardData.grn_number,
                grnDate: formatDateIndian(inwardData.grn_date),
                status: inwardData.status,
                receiverName: inwardData.receiver_name || 'N/A',
                vehicleNumber: inwardData.vehicle_number || 'N/A',
                driverName: inwardData.driver_name || 'N/A',
                materialReceivedDate: formatDateIndian(inwardData.material_received_date),
                billNo: inwardData.bill_no || 'N/A',
                billDate: formatDateIndian(inwardData.bill_date),
                extraCharges: parseFloat(inwardData.extra_charges || 0).toFixed(2),
                dcNumber: inwardData.dc_number || 'N/A',
                dcDate: formatDateIndian(inwardData.dc_date),
                remark: inwardData.remark || '',
                createdAt: formatDateTimeIndian(inwardData.createdAt),
                updatedAt: formatDateTimeIndian(inwardData.updatedAt)
            },
            jobWork: {
                number: jobWork?.job_work_number || 'N/A',
                remarks: jobWork?.remarks || 'N/A'
            },
            vendor: {
                companyName: vendor?.company_name || 'N/A',
                referenceName: vendor?.reference_name || 'N/A',
                primaryContactPerson: vendor?.primary_contact_person || 'N/A',
                primaryContactNumber: vendor?.primary_contact_number || 'N/A',
                primaryContactEmail: vendor?.primary_contact_email || 'N/A',
                gstNumber: vendor?.gst_number || 'N/A',
                panNumber: vendor?.pan_number || 'N/A',
                address: vendor?.address || 'N/A',
                pincode: vendor?.pincode || 'N/A'
            },
            branch: {
                name: branch?.branch_name || 'N/A'
            }
        };

        // Process inward items
        const items = inwardDetails.map((item, index) => {
            const bom = item.bom;
            const operations = item.operation_ids || [];
            const operationNames = operations.map(op => op.operation_masters?.operation_name).filter(name => name).join(', ');

            return {
                srNo: index + 1,
                batchNumber: item.batch_number || 'N/A',
                name: bom?.item_name || 'N/A',
                itemCode: bom?.item_code || 'N/A',
                hsnCode: bom?.hsn_code || 'N/A',
                operations: operationNames || 'N/A',
                quantity: roundTo(item.quantity || 0),
                receivedQty: roundTo(item.received_qty || 0),
                inspectionStatus: item.inspection_status || 'N/A',
                uom: item?.uom?.uom_name || 'N/A'
            };
        });

        // Precompute dynamic items rows
        const itemsRows = items
            .map(item => `
                <tr>
                    <td>${item.srNo}</td>
                    <td>${item.itemCode}</td>
                    <td>${item.name}</td>
                    <td>${item.quantity}</td>
                    <td>${item.uom}</td>
                    <td>${item.receivedQty}</td>
                </tr>
            `).join('');

        // Calculate totals
        const totalQuantity = roundTo(
            items.reduce((sum, item) => sum + (item.quantity || 0), 0)
        );

        const totalReceivedQty = roundTo(
            items.reduce((sum, item) => sum + (item.receivedQty || 0), 0)
        );

        mergedData.items = items;
        mergedData.itemsRows = itemsRows;
        mergedData.totalQuantity = totalQuantity;
        mergedData.totalReceivedQty = totalReceivedQty;
        mergedData.totalItems = items.length;

        // Replace placeholders
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined ? value : match;
        });

        const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });

        const page = await browser.newPage();
        // await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', reject);
                });
            }));
        });


        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });
        await page.close();
        await browser.close();
        return pdfBuffer;  // return buffer
    } catch (error) {
        console.error('Error generating Job Work Inward PDF:', error);
        throw error;
    }
}

const QRCode = require('qrcode');
const { roundTo } = require('./commanFunctions.controller');

async function generateOrderDispatchedPDF(
    organizationId,
    transaction_id,
    data,
    schema,
    dispatch_id = null,
    invoice_id = null
) {
    try {
        if (!schema) throw new Error("Schema is required");
        if (!dispatch_id && !invoice_id)
            throw new Error("Either dispatch_id or invoice_id is required");

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const {
            invoices,
            invoice_items,
            organization_masters,
            order_dispatcheds,
            wos,
            wo_items,
            user_masters,
            branch_masters,
            item_masters,
            client_masters,
            tax_masters,
            uom_masters,
            state_masters
        } = Models;


        // ✅ Fetch organization details
        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error("Organization not found");


        // send schema name and find out organization id from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        // ✅ Fetch active template
        const template = await templates.findOne({
            where: {
                transaction_id,
                organization_id: adminOrganizationId,
                is_active: "Active"
            }
        });
        if (!template) throw new Error("Template not found");

        let dispatchData = null;
        let invoicesData = null;

        // ✅ CASE 1 → If dispatch_id is provided → fetch from order_dispatcheds
        if (dispatch_id) {
            dispatchData = await order_dispatcheds.findOne({
                where: { id: dispatch_id },
                include: [
                    {
                        model: wos,
                        as: "workOrder",
                        include: [
                            {
                                model: branch_masters,
                                as: "branch",
                                include: [
                                    {
                                        model: state_masters,
                                        as: "state"
                                    }
                                ]
                            },
                            {
                                model: client_masters,
                                as: "client",
                                include: [
                                    {
                                        model: state_masters,
                                        as: "state"
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        model: invoices,
                        as: "invoices",
                        include: [
                            {
                                model: invoice_items,
                                as: "invoice_items",
                                include: [
                                    {
                                        model: wo_items,
                                        as: "wo_items",
                                        include: [
                                            {
                                                model: item_masters,
                                                as: "item",
                                                include: [
                                                    {
                                                        model: uom_masters, // ✅ include UOM
                                                        as: "uom"           // ✅ alias as uom
                                                    }
                                                ]
                                            }
                                        ]
                                    },
                                    {
                                        model: tax_masters,
                                        as: "tax"
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        model: user_masters,
                        as: "dispatchedByUser"
                    }
                ]
            });

            if (!dispatchData) throw new Error("Dispatch record not found");
            invoicesData = dispatchData.invoices;
        }

        // ✅ CASE 2 → If invoice_id is provided → fetch directly from invoices
        else if (invoice_id) {
            invoicesData = await invoices.findOne({
                where: { id: invoice_id },
                include: [
                    {
                        model: invoice_items,
                        as: "invoice_items",
                        include: [
                            {
                                model: wo_items,
                                as: "wo_items",
                                include: [
                                    {
                                        model: item_masters,
                                        as: "item",
                                        include: [
                                            {
                                                model: uom_masters, // ✅ include UOM
                                                as: "uom"           // ✅ alias as uom
                                            }
                                        ]
                                    }
                                ]
                            },
                            {
                                model: tax_masters,
                                as: "tax"
                            }
                        ]
                    },
                    {
                        model: wos,
                        as: "workOrders",
                        include: [
                            {
                                model: branch_masters,
                                as: "branch",
                                include: [
                                    {
                                        model: state_masters,
                                        as: "state"
                                    }
                                ]
                            },
                            {
                                model: client_masters,
                                as: "client",
                                include: [
                                    {
                                        model: state_masters,
                                        as: "state"
                                    }
                                ]
                            }
                        ]
                    },
                    {
                        model: user_masters,
                        as: "createdBy"
                    },
                    {
                        model: order_dispatcheds,
                        as: 'orderDispatcheds'
                    }
                ]
            });

            if (!invoicesData) throw new Error("Invoice record not found");

            // Map invoice structure to match dispatchData for PDF
            dispatchData = {
                id: invoice_id,
                invoices: invoicesData,
                workOrder: invoicesData.workOrders,
                dispatchedByUser: invoicesData.createdBy,
                createdAt: invoicesData.createdAt,
                updatedAt: invoicesData.updatedAt
            };
        }

        // generate qr code
        // ✅ create qr instance
        const qrGen = new EInvoiceQRCodeGenerator();

        const result = await qrGen.generateFromSignedQRCode(invoicesData.signed_qr_code, { width: 900 });

        const invoiceItems = invoicesData?.invoice_items || [];
        const workOrder = dispatchData.workOrder;
        const dispatchedByUser = dispatchData.dispatchedByUser;

        // ✅ Check if client and organization are in same state
        const orgStateId = organization.state_id;
        const clientStateId = workOrder?.client?.state_id;
        const isSameState = (orgStateId === clientStateId) || !clientStateId || !orgStateId;

        // ✅ Merge Data
        const mergedData = {
            company: {
                logo: organization.logo_url,
                name: organization.organization_name,
                pan: organization.pan_number,
                cin: organization.cin_number || "",
                gst: organization.gst_number,
                address: organization.address,
                phone: organization.phone_number,
                email: organization.email || "",
                state: organization.state_name || "",
                qrCode: result.data,
                remarks: invoicesData.remarks || ''
            },
            dispatch: {
                id: dispatchData.id,
                dispatchedQty: parseFloat(invoicesData.invoice_qty || 0).toFixed(3),
                dispatchedDate: formatDateTimeIndian(invoicesData.invoice_date),
                createdAt: formatDateTimeIndian(dispatchData.createdAt),
                updatedAt: formatDateTimeIndian(dispatchData.updatedAt)
            },
            workOrder: {
                orderNumber: workOrder?.order_number || "",
                orderDate: formatDateIndian(workOrder?.order_date),
                deliveryDate: formatDateIndian(workOrder?.delivery_date),
                status: workOrder?.status || "",
                address: workOrder?.address || "",
                clientId: workOrder?.client_id || "",
                clientName: workOrder?.client?.client_name || "",
                branchName: workOrder?.branch?.branch_name || "",
                // ✅ add invoice_no from invoices table
                invoiceNo: invoicesData?.invoice_no || "",
                irnNo: invoicesData?.irn_no || '',

                // ✅ Only show these if dispatch happend
                modeOfDispatch: `<p><strong>Mode of Dispatch :</strong> ${invoicesData.orderDispatcheds?.length ? invoicesData.orderDispatcheds[0].transport_mode || "" : ""}</p>`,
                transportName: `<p><strong>Transport Name :</strong> ${invoicesData.orderDispatcheds?.length ? invoicesData.orderDispatcheds[0].driver_name || "" : ""}</p>`,
                vehicleNo: `<p><strong>Vehicle No :</strong> ${invoicesData.orderDispatcheds?.length ? invoicesData.orderDispatcheds[0].vehicle_no || "" : ""}</p>`,

            },
            dispatchedBy: {
                name: dispatchedByUser
                    ? `${dispatchedByUser.first_name} ${dispatchedByUser.last_name}`
                    : "",
                email: dispatchedByUser?.email_id || ""
            },
            client: {
                companyName: workOrder?.client?.client_name || "",
                contactPerson: workOrder?.client?.contact_person_name || "",
                address: workOrder?.client?.address || "",
                phone: workOrder?.client?.phone_number || "",
                email: workOrder?.client?.email_id || "",
                gstNumber: workOrder?.client?.GSTIN_number || "",
                state: workOrder?.client?.state?.state_name || "",
                emailId: workOrder?.client?.email_id || "",
                mobileNo: workOrder?.client?.mobile_number || "",
            }
        };

        // ✅ Prepare Items Array
        const items = invoiceItems.map((invItem, index) => {
            const woItem = invItem.wo_items;
            const item = woItem?.item;

            const productParts = woItem.customer_item_name.split('-');

            let itemCode = '';
            let itemName = '';

            if (productParts.length > 1) {
                itemCode = productParts[0];
                itemName = productParts.slice(1).join('-');
            } else {
                itemName = woItem.customer_item_name;
            }

            const totalPriceWithoutTax = parseFloat(
                parseFloat(invItem?.invoice_qty || 0) *
                parseFloat(invItem?.unit_price || 0)
            ).toFixed(2);

            return {
                srNo: index + 1,
                name: itemName || woItem?.customer_item_name || item?.item_name || "",
                itemCode: itemCode || item?.item_code || "",
                hsnCode: item?.hsn_code || "",
                dispatchedQty: parseInt(invItem?.invoice_qty || 0),
                unitPrice: parseFloat(invItem?.unit_price || 0).toFixed(2),
                taxPercentage: invItem.tax?.tax_percentage || "0",
                totalPrice: parseFloat(invItem?.total_price || 0).toFixed(2),
                totalPriceWithoutTax,
                uom_name: item?.uom?.uom_name || 'Nos',
                packingDetails: invItem?.packing_details || ""
            };
        });

        // ✅ Generate items rows
        const itemsRows = items.map(item => `
            <tr>
                <td style="padding-bottom: 35px;">${item.srNo}</td>
                <td style="padding-bottom: 35px;">${item.itemCode}</td>
                <td style="padding-bottom: 35px;">${item.name}</td>
                <td style="padding-bottom: 35px;">${item.hsnCode}</td>
                <td style="padding-bottom: 35px;">${item.dispatchedQty}</td>
                <td style="padding-bottom: 35px;">${item.uom_name || ""}</td>
                <td style="padding-bottom: 35px;">${item.unitPrice}</td>
                <td style="min-width: 120px; padding-bottom: 35px;">${item.packingDetails}</td>
                <td style="padding-bottom: 35px;">${item.totalPriceWithoutTax}</td>
            </tr>
        `).join("");

        // ✅ Totals
        const totalDispatchedQty = items.reduce((sum, item) => sum + parseFloat(item.dispatchedQty), 0).toFixed(3);
        const totalUnitPrice = items.reduce((sum, item) => sum + parseFloat(item.unitPrice), 0).toFixed(2);

        // Calculate subtotal (without tax) and total (with tax)
        const subTotal = items.reduce((sum, item) => {
            const itemTotal = parseFloat(item.totalPriceWithoutTax || 0);
            return sum + itemTotal;
        }, 0).toFixed(2);

        const totalPrice = Math.round(items.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0));
        const taxAmount = (parseFloat(totalPrice) - parseFloat(subTotal)).toFixed(2);
        const totalQty = Math.round(
            items.reduce((sum, item) => sum + parseFloat(item.dispatchedQty), 0)
        );

        // Calculate average tax percentage
        const taxPercentage = items.length > 0
            ? (items.reduce((sum, item) => sum + parseFloat(item.taxPercentage), 0) / items.length).toFixed(2)
            : '0';

        const amountInWords = toWords.convert(Number(parseFloat(totalPrice || 0)), { currency: true });

        // ✅ Generate tax summary rows based on state matching
        let taxSummaryRows = '';

        if (isSameState) {
            // Same state - show CGST and SGST
            taxSummaryRows = `
                <tr>
                    <td>Gross Amount :</td>
                    <td>₹${subTotal}</td>
                </tr>
                <tr>
                    <td>CGST SALE (${(taxPercentage / 2).toFixed(2)}%) :</td>
                    <td>₹${(taxAmount / 2).toFixed(2)}</td>
                </tr>
                <tr>
                    <td>SGST SALE (${(taxPercentage / 2).toFixed(2)}%) :</td>
                    <td>₹${(taxAmount / 2).toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Net Amount :</td>
                    <td>₹${totalPrice}</td>
                </tr>
            `;
        } else {
            // Different state - show IGST
            taxSummaryRows = `
                <tr>
                    <td>Gross Amount :</td>
                    <td>₹${subTotal}</td>
                </tr>
                <tr>
                    <td>IGST SALE (${taxPercentage}%) :</td>
                    <td>₹${taxAmount}</td>
                </tr>
                <tr>
                    <td>Net Amount :</td>
                    <td>₹${totalPrice}</td>
                </tr>
            `;
        }

        // ✅ Merge computed values
        mergedData.items = items;
        mergedData.itemsRows = itemsRows;
        mergedData.totalDispatchedQty = totalDispatchedQty;
        mergedData.totalUnitPrice = totalUnitPrice;
        mergedData.subTotal = subTotal;
        mergedData.taxAmount = taxAmount;
        mergedData.taxPercentage = taxPercentage;
        mergedData.totalPrice = totalPrice;
        mergedData.totalQty = totalQty;
        mergedData.amountInWords = amountInWords;
        mergedData.taxSummaryRows = taxSummaryRows;

        // ✅ Prepare tax details rows
        const taxDetails = invoiceItems.map(invItem => {
            const taxableVal = parseFloat(invItem.invoice_qty * invItem.unit_price || 0);
            const taxPerc = parseFloat(invItem.tax?.tax_percentage || 0);
            const centralRate = isSameState ? (taxPerc / 2).toFixed(2) : '0.00';
            const stateRate = isSameState ? (taxPerc / 2).toFixed(2) : '0.00';
            const integratedRate = !isSameState ? taxPerc.toFixed(2) : '0.00';

            const taxAmount = parseFloat(invItem.total_price) - taxableVal;
            const centralAmount = isSameState ? (taxAmount / 2).toFixed(2) : '0.00';
            const stateAmount = isSameState ? (taxAmount / 2).toFixed(2) : '0.00';
            const integratedAmount = !isSameState ? taxAmount.toFixed(2) : '0.00';

            return {
                hsnCode: invItem.wo_items?.item?.hsn_code || '',
                taxableValue: taxableVal.toFixed(2),
                centralRate, centralAmount,
                stateRate, stateAmount,
                integratedRate, integratedAmount
            };
        });

        // ✅ Build rows
        const taxDetailsRows = taxDetails.map(t => `
            <tr>
                <td style="border:1px solid #000; padding:6px;">${t.hsnCode}</td>
                <td style="border:1px solid #000; padding:6px;">${t.taxableValue}</td>
                <td style="border:1px solid #000; padding:6px;">${t.centralRate}%</td>
                <td style="border:1px solid #000; padding:6px;">${t.centralAmount}</td>
                <td style="border:1px solid #000; padding:6px;">${t.stateRate}%</td>
                <td style="border:1px solid #000; padding:6px;">${t.stateAmount}</td>
                <td style="border:1px solid #000; padding:6px;">${t.integratedRate}%</td>
                <td style="border:1px solid #000; padding:6px;">${t.integratedAmount}</td>
            </tr>
            `).join('');

        // ✅ Totals
        const totalTaxableValue = taxDetails.reduce((sum, t) => sum + parseFloat(t.taxableValue), 0).toFixed(2);
        const totalCentralTax = isSameState ? taxDetails.reduce((sum, t) => sum + parseFloat(t.centralAmount), 0).toFixed(2) : '0.00';
        const totalStateTax = isSameState ? taxDetails.reduce((sum, t) => sum + parseFloat(t.stateAmount), 0).toFixed(2) : '0.00';
        const totalIntegratedTax = isSameState ? '0.00' : taxDetails.reduce((sum, t) => sum + parseFloat(t.integratedAmount), 0).toFixed(2);

        // ✅ Put into mergedData for HTML template
        mergedData.taxDetailsRows = taxDetailsRows;
        mergedData.totalTaxableValue = totalTaxableValue;
        mergedData.totalCentralTax = totalCentralTax;
        mergedData.totalStateTax = totalStateTax;
        mergedData.totalIntegratedTax = totalIntegratedTax;


        // // ✅ Replace placeholders in template
        // let htmlContent = template.html_content;
        // htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
        //     const value = path.split(".").reduce((obj, key) => obj && obj[key], mergedData);
        //     return value !== undefined ? value : match;
        // });

        // ✅ Create all 4 copies
        const copyLabels = ["ORIGINAL", "DUPLICATE", "TRIPLICATE", "EXTRA"];

        let fullHtmlContent = "";

        for (let i = 0; i < copyLabels.length; i++) {
            const label = copyLabels[i];

            let htmlWithLabel = template.html_content
                .replace('<div class="container">', '<div class="container" style="position: relative; margin-bottom: 20px;">')
                .replace(/\${([^}]+)}/g, (match, path) => {
                    if (path === "copyType") return label;
                    const value = path.split(".").reduce((obj, key) => obj && obj[key], mergedData);
                    return value !== undefined ? value : match;
                });

            fullHtmlContent += htmlWithLabel;

            if (i < copyLabels.length - 1) {
                fullHtmlContent += `<div style="page-break-after: always;"></div>`;
            }
        }

        // ✅ Generate PDF
        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: true
        });

        const page = await browser.newPage();
        await page.setContent(fullHtmlContent, { waitUntil: "networkidle2", timeout: 30000 });

        // ✅ Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll("img"));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener("load", resolve);
                    img.addEventListener("error", reject);
                });
            }));
        });

        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "20px", right: "20px", bottom: "20px", left: "20px" }
        });

        await page.close();
        await browser.close();
        return pdfBuffer;

    } catch (error) {
        console.error("Error generating Order Dispatch PDF:", error);
        throw error;
    }
}

async function generateJobWorkInvoicePDF(
    organizationId,
    transaction_id,
    invoiceData,
    schema,
    invoice_id
) {
    try {
        if (!invoice_id) throw new Error('Invoice ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const {
            invoices,
            invoice_items,
            organization_masters,
            wos,
            user_masters,
            branch_masters,
            item_masters,
            client_masters,
            item_category_masters,
            tax_masters,
            job_work_inward_details,
            wo_items,
            state_masters
        } = Models;

        // ✅ Fetch organization details
        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // send schema name and find out organization id from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        // ✅ Fetch active template
        const template = await templates.findOne({
            where: {
                transaction_id,
                organization_id: adminOrganizationId,
                is_active: 'Active'
            }
        });
        if (!template) throw new Error('Template not found');

        // ✅ Fetch invoice data with relationships
        const invoiceRecord = await invoices.findOne({
            where: { id: invoice_id },
            include: [
                {
                    model: wos,
                    as: "workOrders",
                    include: [
                        {
                            model: branch_masters,
                            as: "branch",
                            required: true,
                            include: [
                                {
                                    model: state_masters,
                                    as: "state"
                                }
                            ]
                        },
                        {
                            model: client_masters,
                            as: "client",
                            required: true,
                            include: [
                                {
                                    model: state_masters,
                                    as: "state"
                                }
                            ]
                        }
                    ]
                },
                {
                    model: user_masters,
                    as: "createdBy"
                },
                {
                    model: invoice_items,
                    as: "invoice_items",
                    required: true,
                    include: [
                        {
                            model: item_category_masters,
                            as: "item_category_masters"
                        },
                        {
                            model: tax_masters,
                            as: "tax"
                        },
                        {
                            model: item_masters,
                            as: "item"
                        },
                        {
                            model: wo_items,
                            as: "wo_items"
                        },
                        {
                            model: job_work_inward_details,
                            as: "job_work_inward_details"
                        }
                    ]
                }
            ]
        });

        if (!invoiceRecord) throw new Error('Invoice record not found');

        // ✅ Get nested data
        const invoiceItems = invoiceRecord.invoice_items || [];
        const workOrder = invoiceRecord.workOrders;
        const createdByUser = invoiceRecord.createdBy;

        // ✅ Check if client and organization are in same state
        const orgStateId = organization.state_id;
        const clientStateId = workOrder?.client?.state_id;
        const isSameState = orgStateId === clientStateId;

        // ✅ create qr instance
        const qrGen = new EInvoiceQRCodeGenerator();

        const result = await qrGen.generateFromSignedQRCode(invoiceRecord.signed_invoice, { width: 300 });


        // ✅ Transform API data for template
        const mergedData = {
            company: {
                logo: organization.logo_url,
                name: organization.organization_name,
                pan: organization.pan_number,
                cin: organization.cin_number || 'N/A',
                gst: organization.gst_number,
                address: organization.address,
                phone: organization.phone_number,
                email: organization.email || '',
                state: organization.state_name || 'N/A',
                qrCode: result.data
            },
            invoice: {
                id: invoiceRecord.id,
                invoiceNo: invoiceRecord.invoice_no,
                invoiceDate: formatDateIndian(invoiceRecord.invoice_date),
                status: invoiceRecord.status,
                type: invoiceRecord.type,
                createdAt: formatDateTimeIndian(invoiceRecord.createdAt),
                updatedAt: formatDateTimeIndian(invoiceRecord.updatedAt)
            },
            workOrder: {
                orderNumber: workOrder?.order_number || 'N/A',
                orderDate: formatDateIndian(workOrder?.order_date),
                deliveryDate: formatDateIndian(workOrder?.delivery_date),
                status: workOrder?.status || 'N/A',
                address: workOrder?.address || 'N/A',
                clientId: workOrder?.client_id || 'N/A'
            },
            createdBy: {
                name: createdByUser
                    ? `${createdByUser.first_name} ${createdByUser.last_name}`
                    : 'N/A',
                email: createdByUser?.email_id || 'N/A'
            },
            client: {
                companyName: workOrder?.client?.client_name || 'N/A',
                contactPerson: workOrder?.client?.contact_person_name || 'N/A',
                address: workOrder?.client?.address || 'N/A',
                phone: workOrder?.client?.phone_number || 'N/A',
                email: workOrder?.client?.email_id || 'N/A',
                gstNumber: workOrder?.client?.GSTIN_number || 'N/A',
                state: workOrder?.client?.state?.state_name || 'N/A'
            }
        };

        // ✅ Prepare items array from invoice_items
        const items = invoiceItems.map((item, index) => {
            return {
                srNo: index + 1,
                name: item.wo_items?.customer_item_name || item.item?.item_name || 'N/A',
                itemCode: item.item?.item_code || 'N/A',
                hsnCode: item.item?.hsn_code || 'N/A',
                quantity: parseFloat(item.invoice_qty || 0).toFixed(3),
                unitPrice: parseFloat(item.unit_price || 0).toFixed(2),
                taxPercentage: item.tax?.tax_percentage || '0',
                totalPrice: parseFloat(item.total_price || 0).toFixed(2)
            };
        });

        // ✅ Build table rows dynamically
        const itemsRows = items.map(item => `
            <tr>
                <td>${item.srNo}</td>
                <td>${item.itemCode}</td>
                <td>${item.name}</td>
                <td>${item.hsnCode}</td>
                <td>${item.quantity}</td>
                <td>${item.unitPrice}</td>
                <td>${item.taxPercentage}%</td>
                <td>${item.totalPrice}</td>
            </tr>
        `).join('');

        // ✅ Calculate totals
        const totalQty = items.reduce((sum, item) => sum + parseFloat(item.quantity), 0).toFixed(3);
        const totalUnitPrice = items.reduce((sum, item) => sum + parseFloat(item.unitPrice), 0).toFixed(2);
        const subTotal = items.reduce((sum, item) => {
            const itemTotal = parseFloat(item.quantity) * parseFloat(item.unitPrice);
            return sum + itemTotal;
        }, 0).toFixed(2);

        // const totalPrice = items.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0).toFixed(2);
        const totalPrice = Math.round(items.reduce((sum, item) => sum + parseFloat(item.totalPrice), 0));
        const taxAmount = (parseFloat(totalPrice) - parseFloat(subTotal)).toFixed(2);

        // Calculate average tax percentage
        const taxPercentage = items.length > 0
            ? (items.reduce((sum, item) => sum + parseFloat(item.taxPercentage), 0) / items.length).toFixed(2)
            : '0';

        const amountInWords = toWords.convert(Number(parseFloat(totalPrice || 0).toFixed(2)), { currency: true });

        // ✅ Generate tax summary rows based on state matching
        let taxSummaryRows = '';

        if (isSameState) {
            // Same state - show GST
            taxSummaryRows = `
                <tr>
                    <td>Gross Amount :</td>
                    <td>₹${subTotal}</td>
                </tr>
                <tr>
                    <td>CGST (${(taxPercentage / 2).toFixed(2)}%) :</td>
                    <td>₹${(taxAmount / 2).toFixed(2)}</td>
                </tr>
                <tr>
                    <td>SGST (${(taxPercentage / 2).toFixed(2)}%) :</td>
                    <td>₹${(taxAmount / 2).toFixed(2)}</td>
                </tr>
                <tr>
                    <td>Total Amount :</td>
                    <td>₹${totalPrice}</td>
                </tr>
            `;
        } else {
            // Different state - show IGST
            taxSummaryRows = `
                <tr>
                    <td>Gross Amount :</td>
                    <td>₹${subTotal}</td>
                </tr>
                <tr>
                    <td>IGST (${taxPercentage}%) :</td>
                    <td>₹${taxAmount}</td>
                </tr>
                <tr>
                    <td>Total Amount :</td>
                    <td>₹${totalPrice}</td>
                </tr>
            `;
        }

        // ✅ Merge computed data
        mergedData.items = items;
        mergedData.itemsRows = itemsRows;
        mergedData.totalQty = totalQty;
        mergedData.totalUnitPrice = totalUnitPrice;
        mergedData.subTotal = subTotal;
        mergedData.taxAmount = taxAmount;
        mergedData.taxPercentage = taxPercentage;
        mergedData.totalPrice = totalPrice;
        mergedData.amountInWords = amountInWords;
        mergedData.taxSummaryRows = taxSummaryRows;

        // ✅ Replace placeholders in template
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined ? value : match;
        });

        // ✅ Generate PDF using puppeteer
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 30000 });

        // ✅ Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', reject);
                });
            }));
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });

        await page.close();
        await browser.close();
        return pdfBuffer;

    } catch (error) {
        console.error('Error generating Job Work Invoice PDF:', error);
        throw error;
    }
}

// Date formatting functions for Indian manufacturing format
const formatDateIndian = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
};

const formatTimeIndian = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    let hours = date.getHours();
    let minutes = date.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // the hour '0' should be '12'
    minutes = minutes < 10 ? '0' + minutes : minutes;
    return `${hours}:${minutes} ${ampm}`;
};

const formatDateTimeIndian = (dateString) => {
    if (!dateString) return '';
    return `${formatDateIndian(dateString)} ${formatTimeIndian(dateString)}`;
};

async function generatePreDispatchInspectionPDF(organizationId, transaction_id, schema, inspection_id) {
    try {
        if (!inspection_id) throw new Error('Inspection ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const {
            organization_masters,
            pre_dispatch_inspections,
            wos,
            item_masters,
            item_inspections,
            user_masters,
            client_masters,
            warehouse_masters,
            branch_masters
        } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // Find organization from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch Pre-Dispatch Inspection data
        const inspectionData = await pre_dispatch_inspections.findOne({
            where: { id: inspection_id },
            include: [
                {
                    model: wos,
                    as: "wo",
                    include: [
                        {
                            model: client_masters,
                            as: "client"
                        },
                        {
                            model: branch_masters,
                            as: "branch"
                        }
                    ]
                },
                {
                    model: item_masters,
                    as: "item"
                },
                {
                    model: user_masters,
                    as: "observer"
                },
                {
                    model: user_masters,
                    as: "approver"
                },
                {
                    model: warehouse_masters,
                    as: "warehouse"
                }
            ]
        });

        if (!inspectionData) {
            throw new Error('Pre-Dispatch Inspection not found');
        }

        // Fetch item inspections for this item
        const itemInspections = await item_inspections.findAll({
            where: {
                item_id: inspectionData.item_id,
                is_active: 'Active'
            },
            order: [['id', 'ASC']]
        });

        const wo = inspectionData.wo;
        const item = inspectionData.item;
        const observer = inspectionData.observer;
        const approver = inspectionData.approver;
        const client = wo?.client;

        // Helper function to format date
        const formatDateIndian = (date) => {
            if (!date) return '';
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = String(d.getFullYear()).slice(-2);
            return `${day}.${month}.${year}`;
        };

        // Prepare merged data
        const mergedData = {
            inspection: {
                documentNo: inspectionData.document_no || '',
                quantity: inspectionData.quantity || 0,
                remark: inspectionData.remark || 'Accepted',
                status: inspectionData.status,
                observationDate: formatDateIndian(inspectionData.observation_date),
                approvalDate: formatDateIndian(inspectionData.approval_date),
                grnNo: '' // Add if available in your system
            },
            item: {
                itemCode: item?.item_code || '',
                itemName: item?.item_name || '',
                hsnCode: item?.hsn_code || ''
            },
            wo: {
                orderNumber: wo?.order_number || '',
                operationName: 'Machining' // Add if available in your WO data
            },
            client: {
                name: client?.client_name || '',
                code: client?.client_code || '',
                customerName: client?.customer_name || client?.client_name || '',
                contactNumber: client?.primary_contact_number || ''
            },
            observer: {
                name: observer ? observer.first_name : '',
                firstName: observer?.first_name || ''
            },
            approver: {
                name: approver ? approver.first_name : '',
                fullName: approver ? `${approver.first_name.charAt(0)}.${approver.last_name}` : ''
            }
        };

        // Process inspection data and generate rows
        const inspections = inspectionData.inspections || [];

        // Separate dimensional and visual inspections
        const dimensionalInspections = [];
        const visualInspections = [];

        inspections.forEach(insp => {
            const itemInspection = itemInspections.find(ii => ii.id === insp.item_inspection_id);
            if (itemInspection) {
                const inspectionType = itemInspection.inspection.toLowerCase();
                const inspectionRow = {
                    ...insp,
                    inspection: itemInspection.inspection,
                    measuring_instruments: itemInspection.measuring_instruments || 'Visual'
                };

                if (inspectionType.includes('visual') || inspectionType.includes('defect')) {
                    visualInspections.push(inspectionRow);
                } else {
                    dimensionalInspections.push(inspectionRow);
                }
            }
        });

        // Generate dimensional inspection rows
        // Generate dimensional inspection rows
        const dimensionalInspectionRows = dimensionalInspections.map((insp, index) => {
            const observations = insp.observations || [];

            // Create an array to hold observation values in order (1-10)
            const observationValues = Array(10).fill('');

            // Fill the observation values based on the 'no' property
            observations.forEach(obs => {
                if (obs && obs.no >= 1 && obs.no <= 10) {
                    observationValues[obs.no - 1] = obs.value !== null && obs.value !== undefined ? obs.value : '';
                }
            });

            const observationCells = observationValues.map(value => {
                if (value !== '') {
                    return `<td class="obs-col">${value}</td>`;
                }
                return `<td class="obs-col"></td>`;
            }).join('');

            return `
        <tr>
            <td class="sr-col">${index + 1}</td>
            <td class="char-col left-align">${insp.inspection || ''}</td>
            <td class="instrument-col">${insp.measuring_instruments || ''}</td>
            <td class="class-col">${insp.special_class || ''}</td>
            <td class="count-col">${insp.least_count || ''}</td>
            ${observationCells}
            <td class="remark-col">${insp.remark || ''}</td>
        </tr>
    `;
        }).join('');

        // Calculate empty rows needed (target around 10-12 total rows for dimensional)
        const targetDimensionalRows = 10;
        const emptyDimensionalCount = Math.max(0, targetDimensionalRows - dimensionalInspections.length);
        const emptyDimensionalRows = Array.from({ length: emptyDimensionalCount }, () =>
            `<tr>
                <td class="sr-col"></td>
                <td class="char-col"></td>
                <td class="instrument-col"></td>
                <td class="class-col"></td>
                <td class="count-col"></td>
                ${'<td class="obs-col"></td>'.repeat(10)}
                <td class="remark-col"></td>
            </tr>`
        ).join('');

        // Add to merged data
        mergedData.dimensionalInspectionRows = dimensionalInspectionRows + emptyDimensionalRows;

        // Replace placeholders in HTML template
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined && value !== null ? value : '';
        });

        // Generate PDF using Puppeteer
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            landscape: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            preferCSSPageSize: true
        });

        await page.close();
        await browser.close();

        return pdfBuffer;

    } catch (error) {
        console.error('Error generating Pre-Dispatch Inspection PDF:', error);
        throw error;
    }
}

async function generateGatePassPDF(organizationId, transaction_id, gatePassData, schema, gate_pass_id, gatePassType) {
    try {
        if (!gate_pass_id) throw new Error('Gate Pass ID is required');
        if (!schema) throw new Error('Schema is required');
        if (!gatePassType) throw new Error('Gate Pass Type is required (returnable or non_returnable)');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const {
            organization_masters,
            branch_masters,
            user_masters,
            inter_godown_transfers,
            igt_items,
            igt_vehicle_details,
            item_masters,
            uom_masters,
            warehouse_masters
        } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // Find organization ID from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch Gate Pass data using Sequelize query
        const gatePassRecord = await inter_godown_transfers.findOne({
            where: { id: gate_pass_id },
            include: [
                {
                    model: branch_masters,
                    as: "fromBranch",
                    required: true
                },
                {
                    model: branch_masters,
                    as: "toBranch",
                    required: false
                },
                {
                    model: user_masters,
                    as: "createdBy"
                },
                {
                    model: user_masters,
                    as: "updatedBy"
                },
                {
                    model: user_masters,
                    as: "approvedBy"
                },
                {
                    model: warehouse_masters,
                    as: "fromWarehouse"
                },
                {
                    model: warehouse_masters,
                    as: "toWarehouse"
                },
                {
                    model: igt_items,
                    as: "igt_items",
                    include: [
                        {
                            model: item_masters,
                            as: "item",
                            include: [
                                {
                                    model: uom_masters,
                                    as: "uom"
                                }
                            ]
                        }
                    ]
                },
                {
                    model: igt_vehicle_details,
                    as: "igt_vehicle_details"
                },
                {
                    model: Models.job_card_operations,
                    as: "jobCardOperation",
                    include: [
                        {
                            model: Models.job_cards,
                            as: "jobCard",
                            attributes: ['job_tracking_number']
                        },
                        {
                            model: Models.operation_masters,
                            as: "operation",
                            attributes: ['operation_name']
                        },
                        {
                            model: Models.item_masters,
                            as: "bomItem",
                            attributes: ['item_name', 'item_code', 'hsn_code']
                        }
                    ]
                }
            ]
        });

        if (!gatePassRecord) {
            throw new Error('Gate Pass not found');
        }

        const fromBranch = gatePassRecord.fromBranch;
        const toBranch = gatePassRecord.toBranch;
        const fromWarehouse = gatePassRecord.fromWarehouse;
        const toWarehouse = gatePassRecord.toWarehouse;
        const vehicleDetails = gatePassRecord.igt_vehicle_details?.[0];

        // Transform API data to template format
        const mergedData = {
            company: {
                logo: organization.logo_url || '',
                name: organization.organization_name || 'N/A',
                pan: organization.pan_number || 'N/A',
                cin: organization.cin_number || 'N/A',
                gst: organization.gst_number || 'N/A',
                addressLine1: organization.address?.split(',')[0] || '',
                addressLine2: organization.address?.split(',').slice(1).join(',') || '',
                phone: organization.phone_number || 'N/A',
                email: organization.email || 'N/A'
            },
            fromLocation: {
                name: fromBranch?.branch_name || 'N/A',
                address: fromBranch?.address || 'N/A',
                gstNumber: organization?.gst_number || 'N/A',
                stateCode: fromBranch?.state_code || 'N/A',
                warehouse: fromWarehouse?.warehouse_name || 'N/A',
                warehouseAddress: fromWarehouse?.address || 'N/A'
            },
            toLocation: {
                name: toBranch?.branch_name || 'N/A',
                address: toBranch?.address || 'N/A',
                gstNumber: organization?.gst_number || 'N/A',
                stateCode: toBranch?.state_code || 'N/A',
                warehouse: toWarehouse?.warehouse_name || 'N/A',
                warehouseAddress: toWarehouse?.address || 'N/A'
            },
            // Add recipient data (using toBranch for NRGP)
            recipient: {
                name: toBranch?.branch_name || 'N/A',
                address: toBranch?.address || 'N/A',
                gstNumber: organization?.gst_number || 'N/A'
            }
        };

        // Common gate pass data
        const commonGatePassData = {
            transfer_no: gatePassRecord.transfer_no || 'N/A',
            documentNumber: gatePassRecord.dc_no || 'N/A',
            documentDate: formatDateIndian(gatePassRecord.transfer_date),
            vehicleNumber: vehicleDetails?.vehicle_no || 'N/A',
            driverName: vehicleDetails?.driver_name || 'N/A',
            transportMode: vehicleDetails?.transport_mode || 'N/A',
            purpose: gatePassRecord.type || 'N/A',
            remarks: gatePassRecord.remark || 'N/A',
            dcNumber: gatePassRecord.dc_no || 'N/A',
            currentPage: 1,
            totalPages: 1,
            // Add fields that might be in RGP template but not in DB
            challanNumber: gatePassRecord.dc_no || 'N/A',
            challanDate: formatDateIndian(gatePassRecord.transfer_date),
            freight: '',
            orderRefNumber: gatePassRecord.transfer_no || '',
            orderDate: gatePassRecord.createdAt ? formatDateIndian(gatePassRecord.createdAt) : 'N/A',
            transporterName: vehicleDetails?.transport_mode || 'N/A',
            removalTime: '',
            paymentTerms: '',
            paymentMode: '',
            delivery: '',
            grNumber: '',
            grDate: ''
        };

        // Add Job Card specific data handling
        if (gatePassRecord.transfer_type === 'Job Card') {
            const jobCardOp = gatePassRecord.jobCardOperation;
            const bomItem = jobCardOp?.bomItem;

            mergedData.jobCard = {
                jobCardNo: jobCardOp?.jobCard?.job_tracking_number || 'N/A',
                batchNo: jobCardOp?.batch_number || 'N/A',
                operationName: jobCardOp?.operation?.operation_name || 'N/A',
                transferQty: gatePassRecord.job_card_data?.transfer_qty || 'N/A',
                itemName: bomItem?.item_name || 'N/A',
                itemCode: bomItem?.item_code || 'N/A',
                hsnCode: bomItem?.hsn_code || 'N/A'
            };
        }

        // Process Gate Pass items
        let items = gatePassRecord.igt_items.map(igtItem => {
            const item = igtItem.item;
            const uom = item?.uom;

            const qty = parseFloat(igtItem.transfer_qty) || 0;
            const rate = parseFloat(igtItem.rate) || 0;
            const taxable = qty * rate;

            return {
                itemCode: item?.item_code || 'N/A',
                name: item?.item_name || 'N/A',
                hsnCode: item?.hsn_code || 'N/A',
                description: item?.description || item?.item_name || 'N/A',
                uom: uom?.name || 'N/A',
                quantity: qty.toString(),
                rate: rate.toFixed(2),
                taxable: taxable.toFixed(2),
                stockQty: igtItem.stock_qty || 0,
                store: fromWarehouse?.warehouse_name || 'N/A'
            };
        });

        let itemsRows = '';
        let totalQty = 0;
        let grossAmount = 0;

        // Check gate pass type and generate appropriate template
        // Check gate pass type and generate appropriate template
        if (gatePassRecord.transfer_type === 'Job Card') {
            // Job Card Gate Pass
            mergedData.jcgp = {
                ...commonGatePassData,
                jobCardNo: mergedData.jobCard?.jobCardNo || 'N/A',
                batchNo: mergedData.jobCard?.batchNo || 'N/A',
                operationName: mergedData.jobCard?.operationName || 'N/A',
                transferQty: mergedData.jobCard?.transferQty || 'N/A',
                approvalRemark: gatePassRecord.approval_remark || 'N/A',
                approvedBy: gatePassRecord.approvedBy?.name || 'N/A',
                approvedDate: formatDateIndian(gatePassRecord.approved_date),
                status: gatePassRecord.status || 'N/A',
                note: gatePassRecord.remark || 'N/A',
                itemName: mergedData.jobCard?.itemName || 'N/A',
                itemCode: mergedData.jobCard?.itemCode || 'N/A',
                hsnCode: mergedData.jobCard?.hsnCode || 'N/A',
            };

            itemsRows = ''; // No items table for Job Card type

        } else if (false) {
            // Returnable Gate Pass specific data
            mergedData.rgp = {
                ...commonGatePassData,
                approvalRemark: gatePassRecord.approval_remark || 'N/A',
                approvedBy: gatePassRecord.approvedBy?.name || 'N/A',
                approvedDate: formatDateIndian(gatePassRecord.approved_date),
                outwardBy: gatePassRecord.outwardBy?.name || 'N/A',
                outwardDate: formatDateIndian(gatePassRecord.outward_date),
                inwardBy: gatePassRecord.inwardBy?.name || 'N/A',
                inwardDate: formatDateIndian(gatePassRecord.inward_date),
                status: gatePassRecord.status || 'N/A',
                note: gatePassRecord.remark || 'TO BE RETURNED WITHIN 180 DAYS',
                pageNumber: '1 of 1'
            };

            // Generate items rows for returnable gate pass
            itemsRows = items
                .map((item, index) => {
                    const qty = Number(item.quantity) || 0;
                    const rate = Number(item.rate) || 0;
                    const taxable = qty * rate;

                    totalQty += qty;
                    grossAmount += taxable;

                    return `
                        <tr>
                            <td>${index + 1}</td>
                            <td style="text-align: left;">${item.name}</td>
                            <td>${item.hsnCode}</td>
                            <td>${qty}</td>
                            <td>${item.uom}</td>
                            <td>${rate.toFixed(2)}</td>
                            <td>${taxable.toFixed(2)}</td>
                        </tr>
                    `;
                })
                .join('');

            // Calculate summary
            const taxPercentage = parseFloat(gatePassRecord.tax_percentage) || 0;
            const taxAmount = (grossAmount * taxPercentage) / 100;
            const netAmount = Math.round(parseFloat(grossAmount + taxAmount));

            const amountInWords = toWords.convert(Number(parseFloat(netAmount || 0)), { currency: true });

            mergedData.summary = {
                grossAmount: grossAmount.toFixed(2),
                taxPercentage: taxPercentage.toFixed(2),
                taxAmount: taxAmount.toFixed(2),
                netAmount: netAmount.toFixed(2),
                amountInWords: amountInWords
            };

        } else if (gatePassType === 'non_returnable' || gatePassType === 'returnable') {
            // Non-Returnable Gate Pass specific data
            mergedData.nrgp = {
                ...commonGatePassData,
                approvalRemark: gatePassRecord.approval_remark || 'N/A',
                approvedBy: gatePassRecord.approvedBy?.name || 'N/A',
                approvedDate: formatDateIndian(gatePassRecord.approved_date),
                status: gatePassRecord.status || 'N/A',

            };

            // Generate items rows for non-returnable gate pass
            itemsRows = items
                .map((item, index) => {
                    const qty = Number(item.quantity) || 0;
                    totalQty += qty;

                    return `
                        <tr>
                            <td>${index + 1}</td>
                            <td>${item.itemCode}</td>
                            <td style="text-align: left;">${item.name}</td>
                            <td>${item.hsnCode}</td>
                            <td>${item.uom}</td>
                            <td>${item.store}</td>
                            <td>${qty}</td>
                        </tr>
                    `;
                })
                .join('');

            // Add total row for non-returnable gate pass
            itemsRows += `
                <tr class="total-row">
                    <td colspan="6" style="text-align:right;"><strong>TOTAL:</strong></td>
                    <td><strong>${totalQty}</strong></td>
                </tr>
            `;
        }

        mergedData.items = items;
        mergedData.itemsRows = itemsRows;

        // Replace placeholders in HTML content
        let htmlContent = template.html_content;

        // More robust placeholder replacement that handles nested paths
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            try {
                const value = path.split('.').reduce((obj, key) => {
                    return obj && obj[key] !== undefined ? obj[key] : null;
                }, mergedData);
                return value !== null ? value : match;
            } catch (error) {
                console.warn(`Failed to replace placeholder: ${match}`, error);
                return match;
            }
        });

        // Generate PDF using Puppeteer
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait for all images to load
        await page.evaluate(async () => {
            const selectors = Array.from(document.querySelectorAll('img'));
            await Promise.all(selectors.map(img => {
                if (img.complete) return;
                return new Promise((resolve, reject) => {
                    img.addEventListener('load', resolve);
                    img.addEventListener('error', reject);
                });
            }));
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });

        await page.close();
        await browser.close();

        return pdfBuffer;

    } catch (error) {
        console.error('Error generating Gate Pass PDF:', error);
        throw error;
    }
}

async function generateJobCardPDF(organizationId, transaction_id, schema, job_card_id) {
    try {
        if (!job_card_id) throw new Error('Job Card ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const {
            organization_masters,
            job_cards,
            wos,
            wo_items,
            item_masters,
            material_masters,
            user_masters,
            job_card_operations,
            job_card_operation_qas,
            wo_item_bom_operation_qa_checklists,
            job_card_operation_pauses,
            production_schedulings,
            operation_masters,
            machine_masters,
            wo_item_bom_operations,
            wo_item_boms,
            branch_masters,
            warehouse_masters
        } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // Find organization from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch Job Card data with all relations
        const jobCardData = await job_cards.findOne({
            where: { id: job_card_id },
            include: [
                {
                    model: wos,
                    as: "workOrder",
                    include: [
                        {
                            model: branch_masters,
                            as: "branch"
                        }
                    ]
                },
                {
                    model: wo_items,
                    as: "workOrderItem"
                },
                {
                    model: item_masters,
                    as: "item",
                    include: [
                        {
                            model: material_masters,
                            as: "material"
                        }
                    ]
                },
                {
                    model: user_masters,
                    as: "creator"
                },
                {
                    model: job_card_operations,
                    as: "job_card_operations",
                    order: [['sequence_no', 'ASC']],
                    include: [
                        {
                            model: job_card_operation_qas,
                            as: "job_card_operation_qas",
                            include: [
                                {
                                    model: wo_item_bom_operation_qa_checklists,
                                    as: "wiboqc"
                                }
                            ]
                        },
                        {
                            model: job_card_operation_pauses,
                            as: "job_card_operation_pauses"
                        },
                        {
                            model: production_schedulings,
                            as: "productionSchedule"
                        },
                        {
                            model: operation_masters,
                            as: "operation"
                        },
                        {
                            model: machine_masters,
                            as: "machine"
                        },
                        {
                            model: wo_item_bom_operations,
                            as: "bomOperation"
                        },
                        {
                            model: item_masters,
                            as: "bomItem",
                            include: [
                                {
                                    model: material_masters,
                                    as: "material"
                                }
                            ]
                        },
                        {
                            model: wo_item_boms,
                            as: "bom"
                        },
                        {
                            model: user_masters,
                            as: "operator"
                        }
                    ]
                }
            ]
        });

        if (!jobCardData) {
            throw new Error('Job Card not found');
        }

        const workOrder = jobCardData.workOrder;
        const item = jobCardData.item;
        const operations = jobCardData.job_card_operations || [];

        // Helper function to format date
        const formatDate = (date) => {
            if (!date) return '';
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        };

        // Helper function to format datetime
        const formatDateTime = (date) => {
            if (!date) return '';
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            let hours = d.getHours();
            const minutes = String(d.getMinutes()).padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12 || 12;
            return `${day}-${month}-${year} ${hours}:${minutes} ${ampm}`;
        };

        // Extract heat numbers from first operation
        const heatNumbers = operations.length > 0 && operations[0].heat_numbers
            ? operations[0].heat_numbers.map(hn => `${hn.heat_number} (Qty: ${hn.quantity})`).join(', ')
            : 'N/A';

        // Prepare company data
        const mergedData = {
            company: {
                name: organization?.organization_name || '',
                logo: organization?.logo_url || '',
                pan: organization?.pan_number || '',
                cin: organization?.cin_number || '',
                gst: organization?.gst_number || '',
                address: organization?.address || '',
                phone: organization?.phone_number || '',
                email: organization?.email || ''
            },
            jobCard: {
                trackingNumber: jobCardData.job_tracking_number || '',
                quantity: jobCardData.quantity || 0,
                status: jobCardData.status || '',
                createdDate: formatDate(jobCardData.createdAt)
            },
            workOrder: {
                orderNumber: workOrder?.order_number || '',
                orderDate: formatDate(workOrder?.order_date),
                deliveryDate: formatDate(workOrder?.delivery_date),
                branchName: workOrder?.branch?.branch_name || ''
            },
            item: {
                itemCode: item?.item_code || '',
                itemName: item?.item_name || '',
                drawingNo: item?.drawing_no || '',
                material: item?.material?.name || '',
                size: item?.size || '',
                weight: item?.weight || '',
                description: item?.description || '',
                heatNumbers: heatNumbers
            }
        };

        // Group operations by bom_id to create unique batch groups
        const batchGroups = {};

        operations.forEach(op => {
            const bomId = op.bom_id || 'unknown';
            const batchNumber = op.batch_number || 'N/A';
            const groupKey = `${bomId}_${batchNumber}`;

            if (!batchGroups[groupKey]) {
                batchGroups[groupKey] = {
                    batchNumber: batchNumber,
                    bom: op.bom,
                    bomItem: op.bomItem,
                    operations: [],
                    materialStatus: op.material_status || 'Pending'
                };
            }
            batchGroups[groupKey].operations.push(op);
        });

        // If only one batch group exists, display each operation as separate row
        const shouldDisplaySeparate = Object.keys(batchGroups).length === 1 && operations.length > 1;

        let allBatchRows = '';

        if (shouldDisplaySeparate) {
            // Display the batch once with all operations listed below
            const firstOp = operations[0];
            const bom = firstOp.bom;
            const bomItem = firstOp.bomItem;
            const batchNumber = firstOp.batch_number || 'N/A';

            const bomRow = `
                <tr class="bom-row">
                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">1</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${batchNumber}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${bomItem?.item_name || ''}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${bomItem?.item_code || ''}</td>
                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${bom?.quantity || 0}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${bom?.remark || ''}</td>
                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${bom?.special_remarks || 'N/A'}</td>
                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${firstOp.material_status || 'Pending'}</td>
                </tr>
            `;

            const operationRows = operations.map((op, opIndex) => {
                const machine = op.machine;
                const operation = op.operation;

                return `
                    <tr class="operation-detail-row">
                        <td colspan="8" style="padding: 15px; border: 1px solid #000; background: #fafafa;">
                            <div style="background: #f5f5f5; padding: 10px; margin-bottom: 10px; border-left: 4px solid #666;">
                                <strong style="font-size: 13px;">Operation: ${operation?.operation_name || ''}</strong>
                            </div>
                            
                            <table style="width: 100%; font-size: 11px; margin-bottom: 0;">
                                <tr>
                                    <td style="width: 25%; padding: 5px; border: none;"><strong>Scheduled Start:</strong></td>
                                    <td style="width: 25%; padding: 5px; border: none;">${formatDateTime(op.scheduled_start)}</td>
                                    <td style="width: 25%; padding: 5px; border: none;"><strong>Actual Start:</strong></td>
                                    <td style="width: 25%; padding: 5px; border: none;">${formatDateTime(op.actual_start_time)}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 5px; border: none;"><strong>Machine:</strong></td>
                                    <td style="padding: 5px; border: none;">${machine?.machine_name || ''}</td>
                                    <td style="padding: 5px; border: none;"><strong>Scheduled End:</strong></td>
                                    <td style="padding: 5px; border: none;">${formatDateTime(op.scheduled_end)}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 5px; border: none;"><strong>Actual Durations:</strong></td>
                                    <td style="padding: 5px; border: none;">${op.actual_durations || ''}</td>
                                    <td style="padding: 5px; border: none;"><strong>Actual End:</strong></td>
                                    <td style="padding: 5px; border: none;">${formatDateTime(op.actual_end_time)}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 5px; border: none;"><strong>Total Break Time:</strong></td>
                                    <td style="padding: 5px; border: none;">${op.actual_setup_durations || '00:00:00'}</td>
                                    <td style="padding: 5px; border: none;"><strong>QA Status:</strong></td>
                                    <td style="padding: 5px; border: none;">${op.is_qc_done ? 'QA Completed' : 'QA Pending'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 5px; border: none;"><strong>Operation Status:</strong></td>
                                    <td style="padding: 5px; border: none;">${op.status}</td>
                                    <td style="padding: 5px; border: none;"><strong>QC Required:</strong></td>
                                    <td style="padding: 5px; border: none;">${op.is_qc_required ? 'Yes' : 'No'}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 5px; border: none;"><strong>Is Sequence Required:</strong></td>
                                    <td colspan="3" style="padding: 5px; border: none;">${op.is_sequence_mandatory ? 'Yes' : 'No'}</td>
                                </tr>
                            </table>
                        </td>
                    </tr>
                `;
            }).join('');

            allBatchRows = bomRow + operationRows;

        } else {
            // Multiple batches - display normally
            let batchIndex = 0;
            for (const groupKey in batchGroups) {
                batchIndex++;
                const batch = batchGroups[groupKey];
                const bom = batch.bom;
                const bomItem = batch.bomItem;
                const batchNumber = batch.batchNumber;

                const bomRow = `
                    <tr class="bom-row">
                        <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${batchIndex}</td>
                        <td style="border: 1px solid #000; padding: 6px 4px;">${batchNumber}</td>
                        <td style="border: 1px solid #000; padding: 6px 4px;">${bomItem?.item_name || ''}</td>
                        <td style="border: 1px solid #000; padding: 6px 4px;">${bomItem?.item_code || ''}</td>
                        <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${bom?.quantity || 0}</td>
                        <td style="border: 1px solid #000; padding: 6px 4px;">${bom?.remark || ''}</td>
                        <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${bom?.special_remarks || 'N/A'}</td>
                        <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${batch.materialStatus}</td>
                    </tr>
                `;

                const operationRows = batch.operations.map((op) => {
                    const machine = op.machine;
                    const operation = op.operation;

                    return `
                        <tr class="operation-detail-row">
                            <td colspan="8" style="padding: 15px; border: 1px solid #000; background: #fafafa;">
                                <div style="background: #f5f5f5; padding: 10px; margin-bottom: 10px; border-left: 4px solid #666;">
                                    <strong style="font-size: 13px;">Operation: ${operation?.operation_name || ''}</strong>
                                </div>
                                
                                <table style="width: 100%; font-size: 11px; margin-bottom: 0;">
                                    <tr>
                                        <td style="width: 25%; padding: 5px; border: none;"><strong>Scheduled Start:</strong></td>
                                        <td style="width: 25%; padding: 5px; border: none;">${formatDateTime(op.scheduled_start)}</td>
                                        <td style="width: 25%; padding: 5px; border: none;"><strong>Actual Start:</strong></td>
                                        <td style="width: 25%; padding: 5px; border: none;">${formatDateTime(op.actual_start_time)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px; border: none;"><strong>Machine:</strong></td>
                                        <td style="padding: 5px; border: none;">${machine?.machine_name || ''}</td>
                                        <td style="padding: 5px; border: none;"><strong>Scheduled End:</strong></td>
                                        <td style="padding: 5px; border: none;">${formatDateTime(op.scheduled_end)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px; border: none;"><strong>Actual Durations:</strong></td>
                                        <td style="padding: 5px; border: none;">${op.actual_durations || ''}</td>
                                        <td style="padding: 5px; border: none;"><strong>Actual End:</strong></td>
                                        <td style="padding: 5px; border: none;">${formatDateTime(op.actual_end_time)}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px; border: none;"><strong>Total Break Time:</strong></td>
                                        <td style="padding: 5px; border: none;">${op.actual_setup_durations || '00:00:00'}</td>
                                        <td style="padding: 5px; border: none;"><strong>QA Status:</strong></td>
                                        <td style="padding: 5px; border: none;">${op.is_qc_done ? 'QA Completed' : 'QA Pending'}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px; border: none;"><strong>Operation Status:</strong></td>
                                        <td style="padding: 5px; border: none;">${op.status}</td>
                                        <td style="padding: 5px; border: none;"><strong>QC Required:</strong></td>
                                        <td style="padding: 5px; border: none;">${op.is_qc_required ? 'Yes' : 'No'}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 5px; border: none;"><strong>Is Sequence Required:</strong></td>
                                        <td colspan="3" style="padding: 5px; border: none;">${op.is_sequence_mandatory ? 'Yes' : 'No'}</td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    `;
                }).join('');

                allBatchRows += bomRow + operationRows;
            }
        }

        mergedData.batchAndOperationRows = allBatchRows;

        // Replace placeholders in HTML template
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined && value !== null ? value : '';
        });

        // Generate PDF using Puppeteer
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            landscape: false,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            preferCSSPageSize: true
        });

        await page.close();
        await browser.close();

        return pdfBuffer;

    } catch (error) {
        console.error('Error generating Job Card PDF:', error);
        throw error;
    }
}

async function generateSaleOrderPDF(organizationId, transaction_id, schema, wo_id) {
    try {
        if (!wo_id) throw new Error('Work Order ID is required');
        if (!schema) throw new Error('Schema is required');

        const Models = getSchemaModels(schema);
        const AdminModels = getSchemaModels("admin_config");
        const { templates, organizations } = AdminModels;
        const {
            organization_masters,
            wos,
            wo_items,
            wo_item_boms,
            wo_item_bom_operations,
            item_masters,
            item_category_masters,
            material_masters,
            branch_masters,
            client_masters,
            user_masters,
            tax_masters,
            operation_masters
        } = Models;

        const organization = await organization_masters.findByPk(organizationId);
        if (!organization) throw new Error('Organization not found');

        // Find organization from admin config
        const params = { organizations, schema };
        const adminOrganizationId = await findOutOrganizationBasedOnSchema(params);
        if (!adminOrganizationId) throw new Error('Admin Organization not found');

        const template = await templates.findOne({
            where: { transaction_id, organization_id: adminOrganizationId, is_active: 'Active' }
        });
        if (!template) throw new Error('Template not found');

        // Fetch Sale Order (Work Order) data with all relations
        const saleOrderData = await wos.findOne({
            where: { id: wo_id, is_active: 'Active' },
            include: [
                {
                    model: branch_masters,
                    as: "branch"
                },
                {
                    model: client_masters,
                    as: "client"
                },
                {
                    model: user_masters,
                    as: "dispatchedBy"
                },
                {
                    model: user_masters,
                    as: "createdBy"
                },
                {
                    model: user_masters,
                    as: "updatedBy"
                },
                {
                    model: wo_items,
                    as: "wo_items",
                    where: { is_active: 'Active' },
                    include: [
                        {
                            model: item_category_masters,
                            as: "item_category_masters"
                        },
                        {
                            model: item_masters,
                            as: "item",
                            include: [
                                {
                                    model: material_masters,
                                    as: "material"
                                }
                            ]
                        },
                        {
                            model: tax_masters,
                            as: "tax"
                        }
                    ]
                }
            ]
        });

        if (!saleOrderData) {
            throw new Error('Sale Order not found');
        }

        // Helper function to format date
        const formatDate = (date) => {
            if (!date) return '';
            const d = new Date(date);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        };

        // Prepare company data
        const mergedData = {
            company: {
                name: organization?.organization_name || '',
                logo: organization?.logo_url || '',
                pan: organization?.pan_number || '',
                cin: organization?.cin_number || '',
                gst: organization?.gst_number || '',
                address: organization?.address || '',
                phone: organization?.phone_number || '',
                email: organization?.email || ''
            },
            saleOrder: {
                client: saleOrderData.client?.client_name || '',
                branch: saleOrderData.branch?.branch_name || '',
                orderNumber: saleOrderData.order_number || '',
                address: saleOrderData.address || '',
                orderDate: formatDate(saleOrderData.order_date),
                deliveryDate: formatDate(saleOrderData.delivery_date),
                status: saleOrderData.status || ''
            }
        };

        // Build item details rows
        let itemDetailsRows = '';
        const items = saleOrderData.wo_items || [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const itemMaster = item.item;
            const category = item.item_category_masters;
            const tax = item.tax;

            // Main item row
            itemDetailsRows += `
                <tr class="item-row">
                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${i + 1}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${category?.item_category_name || ''}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${itemMaster?.item_code || ''}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${itemMaster?.item_name || ''}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${itemMaster.hsn_code || ''}</td>
                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px;">${item.quantity || 0}</td>
                    <td style="text-align: right; border: 1px solid #000; padding: 6px 4px;">${item.unit_price || 0}</td>
                    <td style="border: 1px solid #000; padding: 6px 4px;">${tax?.tax_percentage || ''}</td>
                    <td style="text-align: right; border: 1px solid #000; padding: 6px 4px;">${item.total_price || 0}</td>
                </tr>
            `;

            // Fetch BOMs for this item
            const boms = await wo_item_boms.findAll({
                where: {
                    wo_id: wo_id,
                    wo_item_id: item.id,
                    item_id: itemMaster.id,
                    is_active: 'Active'
                },
                include: [
                    {
                        model: item_masters,
                        as: "bomItem",
                        include: [
                            {
                                model: material_masters,
                                as: "material"
                            },
                            {
                                model: item_category_masters,
                                as: "itemCategory"
                            }
                        ]
                    }
                ]
            });

            if (boms && boms.length > 0) {
                // BOM Details Section
                itemDetailsRows += `
                    <tr class="bom-section-row">
                        <td colspan="10" style="padding: 0; border: 1px solid #000;">
                            <div style="background: #f5f5f5; padding: 8px 10px; font-weight: bold; font-size: 12px;">
                                BOM Details
                            </div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                                <thead>
                                    <tr style="background: #e8e8e8;">
                                        <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Sr.No.</th>
                                        <th style="border: 1px solid #000; padding: 6px 4px;">Item Category</th>
                                        <th style="border: 1px solid #000; padding: 6px 4px;">Item Code</th>
                                        <th style="border: 1px solid #000; padding: 6px 4px;">Item Name</th>
                                        <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">QTY</th>
                                        <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Required QTY</th>
                                    </tr>
                                </thead>
                                <tbody>
                `;

                for (let j = 0; j < boms.length; j++) {
                    const bom = boms[j];
                    const bomItem = bom.bomItem;
                    const bomCategory = bomItem?.itemCategory;

                    itemDetailsRows += `
                        <tr class="bom-item-row">
                            <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${j + 1}</td>
                            <td style="border: 1px solid #000; padding: 6px 4px; background: #fff;">${bomCategory?.item_category_name || ''}</td>
                            <td style="border: 1px solid #000; padding: 6px 4px; background: #fff;">${bomItem?.item_code || ''}</td>
                            <td style="border: 1px solid #000; padding: 6px 4px; background: #fff;">${bomItem?.item_name || ''}</td>
                            <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${item.quantity || 0}</td>
                            <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${bom.quantity || 0}</td>
                            
                        </tr>
                    `;

                    // Fetch Operations for this BOM
                    const operations = await wo_item_bom_operations.findAll({
                        where: {
                            wo_id: wo_id,
                            wo_item_id: item.id,
                            wo_item_bom_id: bom.id,
                            is_active: 'Active'
                        },
                        include: [
                            {
                                model: operation_masters,
                                as: "operation"
                            }
                        ]
                    });

                    if (operations && operations.length > 0) {
                        // Operations Section
                        itemDetailsRows += `
                            <tr class="operation-section-row">
                                <td colspan="7" style="padding: 0; border: 1px solid #000; background: #fafafa;">
                                    <div style="background: #e8e8e8; padding: 8px 10px; font-weight: bold; font-size: 11px;">
                                        Operations
                                    </div>
                                    <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                                        <thead>
                                            <tr style="background: #d9d9d9;">
                                                <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Sr.No.</th>
                                                <th style="border: 1px solid #000; padding: 6px 4px;">Operation</th>
                                                <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Setup Time</th>
                                                <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Estimated Time</th>
                                                <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Sequence No</th>
                                                <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">QC Required</th>
                                                <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Last Operation</th>
                                                <th style="border: 1px solid #000; padding: 6px 4px; text-align: center;">Status</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                        `;

                        for (let k = 0; k < operations.length; k++) {
                            const op = operations[k];
                            const operation = op.operation;

                            itemDetailsRows += `
                                <tr class="operation-row">
                                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${k + 1}</td>
                                    <td style="border: 1px solid #000; padding: 6px 4px; background: #fff;">${operation?.operation_name || ''}</td>
                                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${op.estimated_setup_time || '00:00:00'}</td>
                                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${op.estimated_time || '00:00:00'}</td>
                                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${op.sequence_no || ''}</td>
                                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${op.is_qc_required ? 'Yes' : 'No'}</td>
                                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${op.is_last_operation ? 'Yes' : 'No'}</td>
                                    <td style="text-align: center; border: 1px solid #000; padding: 6px 4px; background: #fff;">${op.status || 'Completed'}</td>
                                    
                                </tr>
                            `;
                        }

                        itemDetailsRows += `
                                        </tbody>
                                    </table>
                                </td>
                            </tr>
                        `;
                    }
                }

                itemDetailsRows += `
                                </tbody>
                            </table>
                        </td>
                    </tr>
                `;
            }
        }

        mergedData.itemDetailsRows = itemDetailsRows;

        // Replace placeholders in HTML template
        let htmlContent = template.html_content;
        htmlContent = htmlContent.replace(/\${([^}]+)}/g, (match, path) => {
            const value = path.split('.').reduce((obj, key) => obj && obj[key], mergedData);
            return value !== undefined && value !== null ? value : '';
        });

        // Generate PDF using Puppeteer
        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            landscape: false,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            preferCSSPageSize: true
        });

        await page.close();
        await browser.close();

        return pdfBuffer;

    } catch (error) {
        console.error('Error generating Sale Order PDF:', error);
        throw error;
    }
}

// Enhanced controller with better error handling
async function generatePDFController(req, res) {
    let pdfPath = null;

    try {
        const { organization_id, transaction_id, data, schema, quotation_id } = req.body;

        if (!organization_id || !transaction_id) {
            return res.status(400).json({
                error: 'Organization ID and Template type are required'
            });
        }

        let pdfBuffer;
        let fileName;

        if (transaction_id == 10) { // quotations (10)
            const timestamp = Date.now();
            fileName = `quotation-${timestamp}.pdf`;
            pdfBuffer = await generateQuotationPDF(organization_id, transaction_id, data, schema, quotation_id);
        }
        else if (transaction_id == 14) { // purchase order (14)
            const { po_id } = req.body;
            const timestamp = Date.now();
            fileName = `purchase-order-${timestamp}.pdf`;
            pdfBuffer = await generatePOPDF(organization_id, transaction_id, data, schema, po_id);
        }
        else if (transaction_id == 15) { // purchase order inward (GRN) (15)
            const { po_inward_id } = req.body;
            const timestamp = Date.now();
            fileName = `po-inward-${timestamp}.pdf`;
            pdfBuffer = await generatePOInwardPDF(organization_id, transaction_id, data, schema, po_inward_id);
        }
        else if (transaction_id == 24) { // job work outward (24)
            const { jw_outward_id } = req.body;
            const timestamp = Date.now();
            fileName = `job-work-outward-${timestamp}.pdf`;
            pdfBuffer = await generateJobWorkOutwardPDF(organization_id, transaction_id, data, schema, jw_outward_id);
        }
        else if (transaction_id == 25) { // job work inward (25)
            const { jw_inward_id } = req.body;
            const timestamp = Date.now();
            fileName = `job-work-inward-${timestamp}.pdf`;
            pdfBuffer = await generateJobWorkInwardPDF(organization_id, transaction_id, data, schema, jw_inward_id);
        }
        else if (transaction_id == 32) { // order dispatched (32)
            const { dispatch_id, invoice_id } = req.body;
            const timestamp = Date.now();
            fileName = `order-dispatch-${timestamp}.pdf`;
            pdfBuffer = await generateOrderDispatchedPDF(organization_id, transaction_id, data, schema, dispatch_id, invoice_id);
        }
        else if (transaction_id == 27) { // job work invoice (27)
            const { invoice_id } = req.body;
            const timestamp = Date.now();
            fileName = `job-work-invoice-${timestamp}.pdf`;
            pdfBuffer = await generateJobWorkInvoicePDF(organization_id, transaction_id, data, schema, invoice_id);
        }
        else if (transaction_id == 35) { // pre dispatch invoice (35)
            const { inspection_id } = req.body;
            const timestamp = Date.now();
            fileName = `pre-dispatch-inspection-${timestamp}.pdf`;
            pdfBuffer = await generatePreDispatchInspectionPDF(organization_id, transaction_id, schema, inspection_id);
        }
        else if ([38, 39, 40].includes(transaction_id)) { // gate pass (38 - returnable, 39 - non_returnable)
            const { gate_pass_id } = req.body;
            const timestamp = Date.now();
            const gatePassType = transaction_id == 38 ? 'returnable' : 'non_returnable';
            fileName = `gate-pass-${timestamp}.pdf`;
            pdfBuffer = await generateGatePassPDF(organization_id, transaction_id, data, schema, gate_pass_id, gatePassType);
        }
        else if (transaction_id == 18) { // job card (18)
            const { job_card_id } = req.body;
            const timestamp = Date.now();
            fileName = `job-card-${timestamp}.pdf`;
            pdfBuffer = await generateJobCardPDF(organization_id, transaction_id, schema, job_card_id);
        }
        else if (transaction_id == 11) { // sale order (11)
            const { wo_id } = req.body;
            const timestamp = Date.now();
            fileName = `sale-order-${timestamp}.pdf`;
            pdfBuffer = await generateSaleOrderPDF(organization_id, transaction_id, schema, wo_id);
        }

        // Send PDF as response (directly from buffer)
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.end(pdfBuffer); // now it's a buffer, not a file path

    } catch (error) {
        console.error('Error in PDF controller:', error);
        res.status(500).json({
            error: error.message || 'Failed to generate PDF'
        });
    }
}

module.exports = {
    generatePDFController, generateOrderDispatchedPDF
};