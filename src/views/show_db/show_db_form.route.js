// file name: show_db_form.route.js
const express = require('express');
const router = express.Router();
const env = process.env.ENV || 'dev';
const config = require('../../app/config/config.json')[env];

// Route for show_db_form
router.get('/show_db', (req, res) => {
  res.render(__dirname + '/show_db_form', {currentPage: 'show_db_form',base_url: config.base_url,isAlterMode: false});
});

module.exports = router;
