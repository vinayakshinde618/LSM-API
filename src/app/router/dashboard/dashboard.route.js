const express = require('express');
const router = express.Router();
const { summary, seats, floors, search } = require('../../controller/dashboard/dashboard.controller');

router.get('/', (req, res) => {
  res.json({
    status: 200,
    message: 'This is dashboard page!',
  });
});

router.get('/summary/:tenant_id/:branch_id', summary);
router.get('/seats/:tenant_id/:floor_id', seats);
router.get('/floors/:tenant_id', floors);
router.get('/search/:tenant_id', search);


module.exports = router;