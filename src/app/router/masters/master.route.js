const express = require('express');
const router = express.Router();
const { saveRecords, getRecords, uploadBinaryFile, modelList, schemaList, runQuery, columnListByModel, syncDatabase, updaterelationaldata, createUpdateRecords, saveUpdateRecords } = require('../../controller/masters/masters.controller');
const dynamicMulter = require('../../middleware/dynamicMulter.middleware');  // Import the middleware
const { saveBase64File } = require('../../controller/commanFunctions/base64FileUpload.controller');

router.get('/', (req, res) => {
  res.json({
    status: 200,
    message: 'This is master page!',
  });
});

// master create and update
router.post('/saveRecords', saveRecords);

// get master list
router.post('/getRecords', getRecords);

// update relational data api
router.post('/updaterelationaldata', updaterelationaldata);
router.post("/createUpdateRecords", createUpdateRecords)

router.post('/saveUpdateRecords', saveUpdateRecords);

// upload binary file using multer
router.post('/uploadBinaryFile', dynamicMulter, uploadBinaryFile);

router.post('/saveBase64File', saveBase64File);
// router.post('/saveBase64FileInS3', saveBase64FileInS3);

// view apis
router.get('/modelList', modelList);
router.get('/columnListByModel/:modelName', columnListByModel);

router.get('/schemaList', schemaList);
router.post('/runQuery', runQuery);

// sync database
router.get('/syncDatabase/:type', syncDatabase);

module.exports = router;