const crypto = require('crypto');

// Example: CBE20261108483920
function generateReference() {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const random = crypto.randomInt(100000, 1000000);

    return `CBE${date}${random}`;
}

module.exports = { generateReference };