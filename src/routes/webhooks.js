const express = require('express');
const { validSignature } = require('../lib/paystack');
const { fulfil } = require('../lib/billing');

const router = express.Router();

router.post('/paystack', express.raw({ type: '*/*', limit: '200kb' }), async (req, res) => {
  const raw = req.body;
  if (!validSignature(raw, req.get('x-paystack-signature'))) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast; Paystack retries otherwise
  try {
    const event = JSON.parse(raw.toString('utf8'));
    if (event.event === 'charge.success' && event.data && event.data.reference) {
      await fulfil(event.data.reference, { paidAmountNaira: event.data.amount / 100 });
    }
  } catch (e) {
    console.error('[webhook]', e.message);
  }
});

module.exports = router;
