const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    status: 200,
    message: 'This is api page!',
  });
});

router.use('/auth', require('./auth/auth.route'));
router.use('/', require('./masters/master.route'));

module.exports = router;
