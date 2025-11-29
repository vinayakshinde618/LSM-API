const express = require('express');
const router = express.Router();
const { signUp, login, setupLogin, forget_password, reset_password } = require('../../controller/auth/auth.controller');

router.get('/', (req, res) => {
  res.json({
    status: 200,
    message: 'This is login api page!'
  });
});

router.post('/signUp', signUp);
router.post('/login', login);

router.post('/setupLogin', setupLogin);

router.post('/forget_password', forget_password);
router.post('/reset_password', reset_password);

module.exports = router;