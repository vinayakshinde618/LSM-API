const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Dynamic function for storing files directly in the uploads folder with random names
const createMulterUpload = () => {
  const uploadsFolderPath = 'uploads';

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(uploadsFolderPath)) {
        fs.mkdirSync(uploadsFolderPath, { recursive: true });
      }
      cb(null, uploadsFolderPath); // Store file in the uploads folder
    },
    filename: (req, file, cb) => {
      const randomName = `${Date.now()}-${Math.floor(Math.random() * 1000)}${path.extname(file.originalname)}`;
      cb(null, randomName); // Assign random file name
    }
  });

  // Initialize multer with storage configuration
  return multer({ storage }).array('files');  // 'files' is the field name that Multer looks for
};

module.exports = createMulterUpload;
