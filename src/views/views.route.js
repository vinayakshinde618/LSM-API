const express = require('express');
const router = express.Router();

// go to dashboard route

router.use('/', require('./login/login_form.route'));

router.use('/', require('./payload_form/payload_form.route'));

router.use('/', require('./show_db/show_db_form.route')); 

module.exports = router;
