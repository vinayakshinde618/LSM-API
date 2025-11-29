
const config = require('../../config/jwt.secret');
const http = require('http');
const axios = require('axios');
const bcrypt = require('bcryptjs');

// send mail function
function sendMailFunction(emailTo, emailCC, emailBCC, subject, body) {
  try {

    if (!emailTo) {
      callback({ code: 0, status: 'Email To is Required', data: '' });
      return;
    }
    if (!subject) {
      callback({ code: 0, status: 'Subject is Required', data: '' });
      return;
    }
    if (!body) {
      callback({ code: 0, status: 'Mail body is Required', data: '' });
      return;
    }
    const nodemailer = require('nodemailer');
    const transporter = nodemailer.createTransport({
      host: 'smtpout.secureserver.net',
      port: 587,
      secure: false,
      auth: {
        user: 'invoice@yumpum.co.in',
        pass: 'Yumpum@2022',
      },
    });
    const mailOptions = {
      from: 'invoice@yumpum.co.in',
      to: emailTo,
      cc: emailCC,
      bcc: emailBCC,
      subject: subject,
      html: body,
    };

    transporter.sendMail(mailOptions, function (error, info) {
      if (error) {
        console.log('error---', error);
        return { code: 0, status: error, data: '' };
      } else {
        console.log('Email sent: ' + info.response);
        return { code: 1, status: 'Email Sent', data: '' };
      }
    });
  } catch (error) {
    console.error('Send mail function error:', error);
    return null;
  }
};

function smsGateWayFunction(mobile) {
  try {
    if (!mobile) {
      return { code: 0, status: 'Mobile Number is Required', data: '' };
    }
    const otp = generateOTP();
    const options = {
      host: config.smsHost,
      path: config.path + mobile + '/' + otp,
    };
    const callback1 = function (response) {
      const str = '';
      response.on('data', function (chunk) {
        str += chunk;
      });
      response.on('end', function () {
        const objdata = JSON.parse(str);
        if (objdata.Status == 'Success') {
          return { code: 1, status: 'OTP Sent', data: '' };
        } else {
          return { code: 0, status: error, data: '' };
        }
      });
    };
    http.request(options, callback1).end();
  } catch (error) {
    console.error('Send sms gateway function error:', error);
    return null;
  }
};

// one signale push notification
function sendPushNotification(playerIds, title, message) {
  try {
    const notificationData = {
      app_id: config.app_id,
      contents: { en: message },
      headings: { en: title },
      included_segments: ['Subscribed Users'],
      included_player_ids: playerIds,
      content_available: true,
      small_icon: 'ic_notification_icon', // can not be an url
      data: {
        PushTitle: 'CUSTOM NOTIFICATION',
      },
    };

    axios.post(config.onesignale_push_notification_url, notificationData, {
      headers: {
        'Authorization': config.authorization,
        'Content-Type': 'application/json'
      }
    }).then(response => {
      return { code: 1, status: 'Notification Sent.', data: '' };
    }).catch(error => {
      return { code: 0, status: 'Error sending push notification:', data: '' };
    });
  } catch (error) {
    console.error('Send push notification function error:', error);
    return null;
  }
}

// graphql
async function graphql(endpoint, operationName, query, variables) {
  try {
    const headers = {
      'content-type': 'application/json',
      Authorization: config.graphql_authorization,
    };
    const graphqlQuery = {
      operationName: operationName,
      query: query,
      variables: variables,
    };

    const options = {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(graphqlQuery),
    };
    const response1 = await fetch(endpoint, options);
    const data = await response1.json();
    if (data.data) {
      return { code: 1, status: 'Success', data: data.data };
    } else {
      return { code: 0, status: 'Fail', data: [] };
    }
  } catch (error) {
    console.error('Graphql function error:', error);
    return null;
  }
};

// generate otp
function generateOTP() {
  try {
    const randomNumber = Math.floor(1000 + Math.random() * 9000);
    return randomNumber;
  } catch (error) {
    console.error('Generate OTP function error:', error);
    return null;
  }
}
// The datesArray will contain each date from '2023-07-01' to '2023-07-21' in yyyy-mm-dd format
async function encryptedFunction(password, inputData) {
  try {
    if (!password) {
      return null;
    }
    const { value, field_name } = password;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(value, salt);
    inputData[field_name] = hashedPassword;
    return 1;
  } catch (error) {
    console.error('Encrypted function error:', error);
    return null;
  }
}

function roundTo(value, decimals = 3) {
  return Number(parseFloat(value).toFixed(decimals));
}

module.exports = { generateOTP, smsGateWayFunction, sendMailFunction, sendPushNotification, graphql, encryptedFunction, roundTo };

