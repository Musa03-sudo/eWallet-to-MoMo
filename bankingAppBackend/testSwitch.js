require('dotenv').config();
const crypto = require('crypto');
const { processTransfer } = require('./services/cbe/cbeSwitch');

const SENDER = '26876123456';
const RECIPIENT = '26876345678';
const FAIL_NUMBER = '26876456789';

const newKey = (name) => `test-step4-${name}-${crypto.randomUUID()}`;

const request = (idempotencyKey, recipientPhone, amount) => ({
  idempotencyKey,
  senderPhone: SENDER,
  recipientPhone,
  amount,
  currency: 'SZL',
});

(async () => {
  const keyA = newKey('a');

  console.log('A. Success:', await processTransfer(request(keyA, RECIPIENT, 1)));
  console.log('B. Insufficient funds:', await processTransfer(request(newKey('b'), RECIPIENT, 999999)));
  console.log('C. Unknown recipient:', await processTransfer(request(newKey('c'), '26870000000', 1)));

  process.env.MOMO_FAIL_CREDIT_PHONES = FAIL_NUMBER;
  console.log('D. MoMo outage:', await processTransfer(request(newKey('d'), FAIL_NUMBER, 1)));

  console.log('E. Same key as A (must NOT move money again):',
    await processTransfer(request(keyA, RECIPIENT, 1)));

  process.exit(0);
})().catch((error) => {
  console.error('Test failed:', error);
  process.exit(1);
});