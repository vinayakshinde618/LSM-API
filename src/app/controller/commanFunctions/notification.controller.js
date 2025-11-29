const nodemailer = require('nodemailer');
const Model = require('../../models');

// send mail function
/**
 * Function to send an email with required fields (To, Subject, Body).
 * @param {string | string[]} emailTo - Recipient email address or an array of addresses.
 * @param {string} subject - Subject of the email.
 * @param {string} body - HTML body of the email.
 * @param {string[]} [emailCC=[]] - CC recipient email addresses (optional).
 * @param {string[]} [emailBCC=[]] - BCC recipient email addresses (optional).
 * @returns {Promise} - Promise with the result of the email sending operation.
 */
/**
 * Function to send an email with required fields (To, Subject, Body).
 */
async function sendMail(emailTo, subject, body, emailCC = [], emailBCC = []) {
  if (!emailTo || (Array.isArray(emailTo) && emailTo.length === 0)) {
    return { code: 0, status: 'Email To is Required', data: '' };
  }
  if (!subject) return { code: 0, status: 'Subject is Required', data: '' };
  if (!body) return { code: 0, status: 'Mail body is Required', data: '' };
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) {
    return { code: 0, status: 'Gmail credentials are not set in environment variables', data: '' };
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: Array.isArray(emailTo) ? emailTo.join(', ') : emailTo,
    cc: Array.isArray(emailCC) ? emailCC.join(', ') : emailCC,
    bcc: Array.isArray(emailBCC) ? emailBCC.join(', ') : emailBCC,
    subject,
    html: body,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[${new Date().toISOString()}] Email sent successfully: ${info.response}`);
    return { code: 1, status: 'Email Sent', data: info.response };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Email failed: ${error.message}`);
    return { code: 0, status: error.message, data: '' };
  }
}

/**
 * Function to fecth user which user having notification access.
 */
async function fetchUsersForEmailNotification(params) {
  const { project_id, notification_type, outwardAssignTo, outwardApprovalAssignTo, installationAssignTo, installationApprovalAssignTo } = params;


  let notifyUserIds = [];

  [outwardAssignTo, outwardApprovalAssignTo, installationAssignTo, installationApprovalAssignTo].forEach(user => user && notifyUserIds.push(user));


  // Fetch all notification access records for the given project
  const notificationData = await Model.notification_accesses.findAll({
    where: { project_id: project_id, notification_type: notification_type, access: true },
    attributes: ['user_id']
  });

  if (notificationData.length > 0) {
    const userIds = notificationData.map(item => item.user_id);

    notifyUserIds = [...notifyUserIds, ...userIds];
  }

  if (notifyUserIds.length) {
    // Fetch user details in a single query
    const users = await Model.user_masters.findAll({
      where: { id: notifyUserIds, is_active: true },
      attributes: ['email_id']
    });

    const email_ids = users.map(user => user.email_id);
    return email_ids;
  }
  else {
    return [];
  }
}

/**
 * Function to maintain notification logs.
 */
async function notificationLogs(project_id, notification_type, user_id, notification_response) {
  const notificationLogs = {
    project_id,
    notification_type,
    user_id,
    notification_response,
    is_active: true
  }
  await Model.notification_logs.create(notificationLogs);
}

module.exports = { sendMail, fetchUsersForEmailNotification, notificationLogs };