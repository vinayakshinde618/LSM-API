const express = require('express');
const router = express.Router();
const env = process.env.ENV || 'dev';
const config = require('../../app/config/config-sample.json')[env];

// table pages
router.get('/payload_form', (req, res) => {
  res.render(__dirname + '/payload_form', { currentPage: 'payload_form', base_url: config.base_url, isAlterMode: false });
});

module.exports = router;
