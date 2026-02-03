const Model = require('../../models');
const { secret } = require('../../config/jwt.secret');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { sendMail } = require('../commanFunctions/notification.controller');
const env = process.env.ENV || 'dev';
const config = require('../../config/config.json')[env];
const { getSchemaModels } = require('./../commanFunctions/schemaModels.controller');
const crypto = require('crypto');
const { Op } = require('sequelize')

exports.signUp = async (req, res) => {
  try {
    const { modelName, whereCondition, inputData, schema } = req.body;

    if (!modelName) { return res.fail('Model name is required.', []); }
    if (!inputData) { return res.fail('Input data is required.', []); }
    if (!whereCondition) { return res.fail('Where condition is required.', []); }
    if (!schema) return res.fail('Schema is required.', []);

    const user = inputData;
    const { password } = user;
    if (!password) { return res.fail('Password is required.', []); }

    const Model = getSchemaModels(schema);

    const result = await Model[modelName].findOne({ where: whereCondition });
    if (result) { return res.fail('User already exists!', []); }

    const salt = await bcrypt.genSalt(10); // await for the salt generation
    const hash = await bcrypt.hash(password, salt); // await for the password hashing
    inputData.password = hash;
    await Model[modelName].create(user);
    return res.success('User created successfully.', []);
  } catch (error) {
    console.error('Error while creating user', error);
    return res.fail('Error while creating user', []);
  }
};

exports.login = async (req, res) => {
  try {
    const { whereCondition, password, modelName } = req.body;
    if (!whereCondition) { return res.fail('Where condition is required.', []); }
    if (!modelName) { return res.fail('Model name is required.', []); }

    const user = await Model[modelName].findOne({ where: whereCondition });

    if (!user) {
      return res.fail('User not found, please check credentials', []);
    }
    const schema = 'public';
    const token = jwt.sign({ id: user.id }, secret, { expiresIn: 86400 }); // 86400 is 24 hours
    return res.success('User logged in successfully.', { schema, user, token });
  } catch (error) {
    console.error('Error during user authentication:', error);
    return res.catchError('Internal Server Error.', []);
  }
};

async function getAllCustomSchemas() {
  const [schemas] = await Model.sequelize.query(`
    SELECT schema_name 
    FROM information_schema.schemata 
    WHERE schema_name NOT LIKE 'pg_%' 
    AND schema_name NOT IN ('information_schema', 'admin_config') 
    ORDER BY schema_name
  `);
  return schemas.map(s => s.schema_name);
}

async function findUserInSchemas({ whereCondition, password, modelName, schema }) {
  try {
    let schemas = [];
    if (schema) {
      schemas = [schema];
    }
    else {
      schemas = await getAllCustomSchemas();
    }

    let userFound = false;

    for (const schema of schemas) {
      const models = getSchemaModels(schema);

      const user = await models[modelName].findOne({ where: whereCondition });
      if (user) {
        userFound = true;
        const isValid = await bcrypt.compare(password, user.password);
        if (isValid) {
          return { success: true, user, schema: schema };
        }
      }
    }

    if (userFound) {
      return { success: false, message: 'Invalid password.' };
    } else {
      // Assuming whereCondition contains email/username field
      return { success: false, message: `Username doesn't exist!` };
    }
  }
  catch (error) {
    console.error('Error while finding user in schemas:', error);
    return { success: false, message: 'Error while finding user!' };
  }
}

exports.setupLogin = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.fail('User name and password is required!', []);
    }
    if (username == 'vinayaks') {
      const enryptedPassword = '$2a$12$MDPriJpbybk8j6rqSJAzDOlGxJWyRL1UoT2WlWCllHfNCx1/gjiCe';
      const isPasswordValid = await bcrypt.compare(password, enryptedPassword);
      if (!isPasswordValid) { return res.fail('Password is not valid!', []); }

      return res.success('Login Successfully', 'success');
    } else {
      return res.fail('Wrong Credential!', []);
    }
  } catch (error) {
    console.error('Set up login error:', error);
    return null;
  }
};

// Function to send OTP for password reset
exports.forget_password = async (req, res) => {
  try {
    const { email, modelName } = req.body;

    if (!email) {
      return res.fail('Email is required!', []);
    }
    if (!modelName) {
      return res.fail('Model name is required!', []);
    }

    // Check if the user exists in any schema
    const schemas = await getAllCustomSchemas();
    let userFound = null;
    let userSchema = null;
    let models = null;

    for (const schema of schemas) {
      models = getSchemaModels(schema);
      const user = await models[modelName].findOne({
        where: {
          email_id: email,
          is_active: 'Active'
        }
      });

      if (user) {
        userFound = user;
        userSchema = schema;
        break;
      }
    }

    if (!userFound) {
      return res.fail('This email is not registered or account is inactive', []);
    }

    // Generate 4-digit OTP
    const otp = crypto.randomInt(1000, 9999); // Generates 1000-9999
    // const otp = 1234;

    // Set OTP expiration (5 minutes from now)
    const otpExpiration = new Date();
    otpExpiration.setMinutes(otpExpiration.getMinutes() + 5);

    // Save OTP to user record
    await userFound.update({
      reset_password_otp: otp,
      reset_password_otp_expires: otpExpiration
    }, { transaction: null, schemaModels: models });

    const username = userFound.first_name + ' ' + userFound.last_name;

    // find the organization_name from the organization_masters table
    const organization = await models.organization_masters.findByPk(userFound.organization_id, {
      attributes: ['organization_name']
    });

    const organizationName = organization ? organization.organization_name : 'LogicLoom IT Solutions';

    // Prepare email content
    const subject = 'Your Password Reset OTP';
    const body = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset OTP</title>
    </head>
    <body style="font-family: Arial, sans-serif; margin: 0; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; border: 1px solid #ddd; padding: 20px; border-radius: 5px;">
        <h3 style="color: #333;">Password Reset OTP</h3>
        <p>Hello <strong>${username}</strong>,</p>
        <p>Your OTP for password reset is:</p>
        <div style="font-size: 24px; font-weight: bold; margin: 20px 0; padding: 10px; background: #f5f5f5; display: inline-block;">
          ${otp}
        </div>
        <p>This OTP is valid for 5 minutes only.</p>
        <p>Thank you!</p>
        <p>If you didn't request this, please ignore this email.</p>
        <p>© ${new Date().getFullYear()} ${organizationName}</p>
      </div>
    </body>
    </html>
    `;

    // Send the email
    const emailResult = await sendMail(email, subject, body);

    if (emailResult.code === 1) {
      return res.success('OTP sent to your email successfully.', {
        schema: userSchema,
        email: email
      });
    } else {
      console.error('Error sending email:', emailResult.status);
      return res.fail('Failed to send OTP, try again later.', []);
    }
  } catch (error) {
    console.error('Error in forget_password:', error);
    return res.catchError('Internal server error', []);
  }
};

// Function to verify OTP and reset password
exports.reset_password = async (req, res) => {
  try {
    const { schema, email, otp, newPassword, confirmPassword } = req.body;

    // Validate inputs
    if (!schema || !email || !otp || !newPassword || !confirmPassword) {
      return res.fail('All fields are required!', []);
    }

    if (newPassword !== confirmPassword) {
      return res.fail('Passwords do not match!', []);
    }

    // Get user from specified schema
    const models = getSchemaModels(schema);
    const user = await models.user_masters.findOne({
      where: {
        email_id: email,
        reset_password_otp: otp,
        reset_password_otp_expires: { [Op.gt]: new Date() }
      }
    });

    if (!user) {
      return res.fail('Invalid OTP or OTP has expired', []);
    }

    // Hash and update password
    await user.update({
      password: newPassword,
      reset_password_otp: null,
      reset_password_otp_expires: null
    }, { transaction: null, schemaModels: models });

    return res.success('Password has been reset successfully.', []);
  } catch (error) {
    console.error('Error in reset_password:', error);
    return res.catchError('Internal server error', []);
  }
};