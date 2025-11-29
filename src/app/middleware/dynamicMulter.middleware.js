const multer = require('multer');
const path = require('path');
const fs = require('fs');
const compressMedia = require('compress-media-stream'); // Make sure the path is correct

// Create dynamic multer middleware for multiple file uploads
const dynamicMulter = (req, res, next) => {
  const folderPath = req.body.folderPath || 'uploads'; // Default to 'uploads' if folderPath not provided
  const fieldName = req.body.fieldName || 'files'; // Default to 'files' if fieldName not provided

  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
    console.warn(`Directory created at: ${folderPath}`);
  }

  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, folderPath);
    },
    filename: function (req, file, cb) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  });

  const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
      const filetypes = /jpeg|jpg|png|gif|mp4|mp3|wav|pdf|doc|docx/;
      const mimetype = filetypes.test(file.mimetype);
      const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

      if (mimetype && extname) {
        return cb(null, true);
      } else {
        cb(new Error('Only image, video, audio, and document files are allowed!'));
      }
    }
  }).array(fieldName);

  upload(req, res, async function (err) {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({
        success: false,
        message: `Multer Error: ${err.message}`
      });
    } else if (err) {
      return res.status(400).json({
        success: false,
        message: `Error: ${err.message}`
      });
    }
    // Proceed to the next middleware or route handler
    next();
        
    // Process and compress each uploaded file
    try {
      for (const file of req.files) {
        const fileExtension = path.extname(file.originalname).toLowerCase().substring(1); // Remove the dot
        const params = {
          mediaData: fs.readFileSync(file.path).toString('base64'), // Convert file to base64
          folderPath: folderPath,
          fileName: path.parse(file.filename).name, // Get the name without extension
          fileExtension: fileExtension
        };

        // Compress file based on type
        switch (fileExtension) {
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
          await compressMedia.image(params);
          break;
        case 'mp3':
        case 'wav':
          await compressMedia.audio(params);
          break;
        case 'mp4':
          await compressMedia.video(params);
          break;
        case 'pdf':
          await compressMedia.application(params);
          break;
        default:
          console.warn(`Unsupported file type: ${fileExtension}`);
        }
      }
    } catch (compressionError) {
      return res.status(500).json({
        success: false,
        message: `Compression Error: ${compressionError.message}`
      });
    }

  });
};

module.exports = dynamicMulter;
