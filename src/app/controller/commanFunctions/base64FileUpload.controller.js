const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AWS = require('aws-sdk');

// Helper function to save files
async function saveBase64File(req, res) {
  try {
    const payload = req.body; // Extract payload from the request body

    if (!Array.isArray(payload)) {
      return res.fail('Payload must be an array.');
    }

    const result = [];

    for (const item of payload) {
      if (!item.filePath || !item.file) {
        return res.fail('Each item must have \'filePath\' and \'file\' properties.');
      }

      // Extract MIME type and Base64 content from the data URI
      const base64Parts = item.file.split(',');
      const base64String = base64Parts[1]; // Remove the prefix if it exists
      const mimeTypeMatch = base64Parts[0].match(/data:(.*?);base64/);

      if (!mimeTypeMatch) {
        return res.fail('Invalid Base64 format.');
      }

      const mimeType = mimeTypeMatch[1];
      const extension = mimeType.split('/')[1]; // Get extension from MIME type

      // Default directory is 'uploads'
      let dirPath = path.resolve('uploads');

      // If a specific subfolder is provided, adjust the directory path
      if (item.filePath) {
        dirPath = path.join('uploads', item.filePath);
      }

      // Create the directory if it doesn't exist
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Generate a random filename with the determined extension
      const fileBuffer = Buffer.from(base64String, 'base64');
      const randomFileName = crypto.randomBytes(16).toString('hex');
      const fileName = `${randomFileName}.${extension}`;
      const fullPath = path.join(dirPath, fileName);

      // Write the file to the specified path
      fs.writeFileSync(fullPath, fileBuffer);

      // Normalize the file path to use forward slashes
      const normalizedFilePath = fullPath.replace(/\\/g, '/');

      // Add the stored file path and name to the result
      result.push({
        filePath: normalizedFilePath, // The path where the file is saved
        fileName: fileName, // The name of the file
      });
    }

    return res.success('Files uploaded successfully.', result);
  } catch (error) {
    console.error('Error saving files:', error);
    return res.catchError('An error occurred while saving files.', error.message);
  }
}

// // Configure AWS SDK
// const s3 = new AWS.S3({
//   region: process.env.AWS_REGION,
//   accessKeyId: process.env.AWS_ACCESS_KEY_ID,
//   secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
// });

// Helper function to save files to S3
async function saveBase64FileInS3(req, res) {
  try {
    const payload = req.body; // Extract payload from the request body

    if (!Array.isArray(payload)) {
      return res.fail('Payload must be an array.');
    }

    const result = [];

    for (const item of payload) {
      if (!item.filePath || !item.file) {
        return res.fail('Each item must have \'filePath\' and \'file\' properties.');
      }

      // Extract MIME type and Base64 content from the data URI
      const base64Parts = item.file.split(',');
      const base64String = base64Parts[1]; // Remove the prefix if it exists
      const mimeTypeMatch = base64Parts[0].match(/data:(.*?);base64/);

      if (!mimeTypeMatch) {
        return res.fail('Invalid Base64 format.');
      }

      const mimeType = mimeTypeMatch[1];
      const extension = mimeType.split('/')[1]; // Get extension from MIME type

      // Generate a random filename with the determined extension
      const fileBuffer = Buffer.from(base64String, 'base64');
      const randomFileName = crypto.randomBytes(16).toString('hex');
      const fileName = `${randomFileName}.${extension}`;

      // Construct the S3 key (path + filename)
      const s3Key = item.filePath ? `${item.filePath}/${fileName}` : fileName;

      // Upload parameters for S3
      const uploadParams = {
        Bucket: 'tmpms',
        Key: s3Key,
        Body: fileBuffer,
        ContentType: mimeType,
        // Add any additional metadata if needed
        // Metadata: {}
      };

      // Upload to S3
      const uploadResult = await s3.upload(uploadParams).promise();

      // Add the S3 URL and key to the result
      result.push({
        filePath: uploadResult.Key, // The S3 key (path + filename)
        fileName: fileName, // The name of the file
        location: uploadResult.Location, // The public URL of the file
        bucket: uploadResult.Bucket // The bucket name
      });
    }

    return res.success('Files uploaded to S3 successfully.', result);
  } catch (error) {
    console.error('Error saving files to S3:', error);
    return res.catchError('An error occurred while saving files to S3.', error.message);
  }
}

module.exports = { saveBase64File, saveBase64FileInS3 };
