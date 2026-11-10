import { useEffect, useRef, useState } from 'react';
import './App.css';
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api';
const MAX_PIN_ATTEMPTS = 3;
const SHORT_CODES = {
  ewallet: '*130*392#',
  momo: '*007#',
};
const createSession = (service = 'ewallet') => ({
  step: 'mobile',
  mobile: '',
  customer: null,
  momoToken: null,
  momoCustomer: null,
  voucher: null,
  recipient: '',
  recipientDetails: null,
  amount: '',
  review: null,
  pinAttempts: 0,
  idempotencyKey: '',
  nationalId: '',
  registrationPin: '',
  confirmRegistrationPin: '',
  messages: [
    {
      type: 'system',
      text:
        service === 'ewallet'
          ? 'Welcome to Uneswa eWallet.\n\nEnter your mobile number:'
          : 'Welcome to MTN MoMo.\n\nEnter your mobile number:',
    },
  ],
});
const createSessions = () => ({
  ewallet: createSession('ewallet'),
  momo: createSession('momo'),
});
// ==========================================
// API REQUEST
// ==========================================
async function apiRequest(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new Error(
      'Cannot connect to the backend. Check that Node.js is running and the API URL is correct.'
    );
  }
  let data = {};
  try {
    data = await response.json();
  } catch {
    // Server did not return JSON.
  }
  if (!response.ok) {
    const error = new Error(
      data.message || `Server error (${response.status}).`
    );
    // Preserve backend error information for the frontend.
    error.code = data.code;
    error.status = response.status;
    throw error;
  }
  return data;
}
// ==========================================
// VALIDATION AND FORMATTING
// ==========================================
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^\d{8}$/.test(digits)) {
    return digits;
  }
  if (/^268\d{8}$/.test(digits)) {
    return digits.substring(3);
  }
  return null;
}
function formatPhoneNumber(value) {
  const localNumber = normalizePhone(value);
  return localNumber ? `268${localNumber}` : null;
}
function validAmount(value) {
  return (
    /^\d+(\.\d{1,2})?$/.test(String(value)) &&
    Number.isFinite(Number(value)) &&
    Number(value) > 0
  );
}
function money(value, currency = 'SZL') {
  return `${currency || 'SZL'} ${Number(value || 0).toFixed(2)}`;
}
// ==========================================
// MAIN APP
// ==========================================
function App() {
  const [activeTab, setActiveTab] = useState('ewallet');
  const [sessions, setSessions] = useState(createSessions);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const displayRef = useRef(null);
  const session = sessions[activeTab];
  useEffect(() => {
    setInput('');
  }, [activeTab]);
  useEffect(() => {
    if (displayRef.current) {
      displayRef.current.scrollTop =
        displayRef.current.scrollHeight;
    }
  }, [session.messages]);
  // ==========================================
  // SESSION STATE
  // ==========================================
  function updateSession(service, updates) {
    setSessions((previous) => ({
      ...previous,
      [service]: {
        ...previous[service],
        ...updates,
      },
    }));
  }
  function showScreen(service, message, step, updates = {}) {
    setSessions((previous) => ({
      ...previous,
      [service]: {
        ...previous[service],
        ...updates,
        step,
        messages: [
          {
            type: 'system',
            text: message,
          },
        ],
      },
    }));
    setInput('');
  }
  function showMainMenu(customer) {
    const name =
      `${customer.name || ''} ${customer.surname || ''}`.trim() ||
      'Customer';
    showScreen(
      'ewallet',
      `UNESWA eWALLET
Welcome, ${name}.
Mobile: ${customer.phone_number}
Account: REGISTERED
Account Type: ${customer.account_type || 'STANDARD'}
Available Balance:
${money(customer.wallet_balance, customer.currency)}
1. Get Card
2. Prepaid
3. Cash at Shop
4. Postpaid eWallet
5. History
7. Send to MTN MoMo
8. Send Money
0. Exit
Select an option:`,
      'menu',
      {
        customer,
        idempotencyKey: '',
        voucher: null,
        recipient: '',
        recipientDetails: null,
        amount: '',
        review: null,
      }
    );
  }
  function resetCurrentSession() {
    setSessions((previous) => ({
      ...previous,
      [activeTab]: createSession(activeTab),
    }));
    setInput('');
  }
  function resetAllSessions() {
    setSessions(createSessions());
    setInput('');
  }
  // ==========================================
  // 1. CHECK SENDER IN DATABASE
  // ==========================================
  async function checkCustomer(phone) {
    showScreen(
      'ewallet',
      'Checking your eWallet registration...\n\nPlease wait.',
      'checkingCustomer',
      {
        mobile: phone,
        customer: null,
        voucher: null,
      }
    );
    try {
      const data = await apiRequest(
        `/ewallet/ussd/customer/${encodeURIComponent(phone)}`
      );
      if (!data.success || !data.customer) {
        throw new Error(
          data.message || 'Customer details were not returned.'
        );
      }
      showMainMenu(data.customer);
    } catch (error) {
      // A customer who is not registered may have vouchers.
      if (error.code === 'NOT_REGISTERED') {
        await checkVoucher(phone);
        return;
      }
      showScreen(
        'ewallet',
        `CUSTOMER LOOKUP FAILED
${error.message}
Your eWallet number could not be verified.
Please check your number or contact support.
Session ended.`,
        'ended',
        {
          mobile: phone,
          customer: null,
          voucher: null,
        }
      );
    }
  }
  // ==========================================
  // 2. CHECK VOUCHERS FOR UNREGISTERED CUSTOMER
  // ==========================================
  async function checkVoucher(phone) {
    showScreen(
      'ewallet',
      'You are not yet registered for eWallet.\n\nChecking your available vouchers...\n\nPlease wait.',
      'checkingVoucher',
      {
        mobile: phone,
        customer: null,
      }
    );
    try {
      const data = await apiRequest(
        `/ewallet/ussd/voucher/${encodeURIComponent(phone)}`
      );
      if (!data.success || !data.voucher) {
        throw new Error(
          data.message || 'Voucher information was not returned.'
        );
      }
      const voucher = data.voucher;
      showScreen(
        'ewallet',
        `UNESWA eWALLET
CUSTOMER NOT REGISTERED
Mobile Number:
${voucher.phone_number}
Available Balance:
${money(voucher.total_available_balance, voucher.currency)}
You can use your voucher balance to register for eWallet.
1. View Voucher Information
7. Register for eWallet
0. Exit
Select an option:`,
        'voucherMenu',
        {
          mobile: phone,
          voucher,
          customer: null,
        }
      );
    } catch (error) {
      showScreen(
        'ewallet',
        `CUSTOMER LOOKUP FAILED
${error.message}
No available vouchers were found for this number.
Please check your number or contact support.
Session ended.`,
        'ended',
        {
          mobile: phone,
          customer: null,
          voucher: null,
        }
      );
    }
  }
  // ==========================================
  // 3. START EWALLET REGISTRATION
  // ==========================================
  function startRegistration() {
    const current = sessions.ewallet;
    if (!current.voucher) {
      showScreen(
        'ewallet',
        'Voucher information is missing.\n\nPlease start a new session.',
        'ended'
      );
      return;
    }
    showScreen(
      'ewallet',
      `EWALLET REGISTRATION
You are about to register for Uneswa eWallet.
Mobile Number:
${current.mobile}
Available Voucher Balance:
${money(
        current.voucher.total_available_balance,
        current.voucher.currency
      )}
Your available voucher balance will be credited to your new eWallet account after successful registration.
1. Yes, Continue
2. No, Cancel
Select an option:`,
      'registrationConfirm'
    );
  }
  // ==========================================
  // 4. SUBMIT CUSTOMER REGISTRATION
  // ==========================================
  // confirmedPin is passed in directly because React state
  // (sessions) has not updated yet when this is called from
  // the confirmRegistrationPin step.
  async function registerCustomer(confirmedPin) {
    const current = sessions.ewallet;
    if (!current.mobile || !current.voucher) {
      showScreen(
        'ewallet',
        'Registration information is missing.\n\nPlease start a new session.',
        'ended'
      );
      return;
    }
    if (!current.nationalId.trim()) {
      showScreen(
        'ewallet',
        'National ID is required.\n\nEnter your National ID:',
        'nationalId'
      );
      return;
    }
    if (!/^\d{5}$/.test(current.registrationPin)) {
      showScreen(
        'ewallet',
        'Your transaction PIN must contain exactly five digits.\n\nCreate your PIN:',
        'createRegistrationPin'
      );
      return;
    }
    if (current.registrationPin !== confirmedPin) {
      showScreen(
        'ewallet',
        'The PINs do not match.\n\nPlease create your PIN again:',
        'createRegistrationPin',
        {
          registrationPin: '',
          confirmRegistrationPin: '',
        }
      );
      return;
    }
    showScreen(
      'ewallet',
      'Processing your eWallet registration...\n\nPlease wait.',
      'registering',
      { confirmRegistrationPin: confirmedPin }
    );
    try {
      const data = await apiRequest('/ewallet/ussd/register', {
        method: 'POST',
        body: JSON.stringify({
          phone_number: current.mobile,
          national_id: current.nationalId.trim(),
          pin: current.registrationPin,
          confirm_pin: confirmedPin,
        }),
      });
      if (!data.success || !data.customer) {
        throw new Error(
          data.message || 'Registration could not be completed.'
        );
      }
      const customer = data.customer;
      showScreen(
        'ewallet',
        `REGISTRATION SUCCESSFUL!
Welcome to Uneswa eWallet.
Your account has been created successfully.
Account Type:
${customer.account_type || 'BETA'}
Wallet Balance:
${money(customer.wallet_balance, customer.currency)}
Your voucher credits have been added to your eWallet balance.
1. Continue to Main Menu`,
        'registrationSuccess',
        {
          customer,
          voucher: null,
          recipient: '',
          recipientDetails: null,
          amount: '',
          review: null,
          pinAttempts: 0,
          registrationPin: '',
          confirmRegistrationPin: '',
        }
      );
    } catch (error) {
      showScreen(
        'ewallet',
        `REGISTRATION FAILED
${error.message}
Your registration could not be completed.
1. Try Again
0. Exit`,
        'registrationFailed'
      );
    }
  }
  // ==========================================
  // 5. CHECK MTN MOMO RECIPIENT
  // ==========================================
  async function checkRecipient(recipientPhone) {
    const current = sessions.ewallet;
    if (!current.customer) {
      showScreen(
        'ewallet',
        'Customer information is missing.\n\nPlease start a new session.',
        'ended'
      );
      return;
    }
    if (recipientPhone === current.mobile) {
      showScreen(
        'ewallet',
        'You cannot send money to your own number.\n\nEnter another recipient mobile number:',
        'recipient'
      );
      return;
    }
    showScreen(
      'ewallet',
      'Checking recipient MTN MoMo registration...\n\nPlease wait.',
      'checkingRecipient',
      { recipient: recipientPhone }
    );
    try {
      const data = await apiRequest(
        `/ewallet/ussd/recipient/${encodeURIComponent(recipientPhone)}`
      );
      if (!data.success || !data.recipient) {
        throw new Error(
          data.message || 'Recipient details were not returned.'
        );
      }
      const recipient = data.recipient;
      showScreen(
        'ewallet',
        `RECIPIENT FOUND
Name: ${recipient.fullname}
Mobile: ${recipient.phone_number}
Status: ${recipient.activity}
Enter amount to send (SZL):`,
        'amount',
        {
          recipient: recipientPhone,
          recipientDetails: recipient,
        }
      );
    } catch (error) {
      showScreen(
        'ewallet',
        `RECIPIENT LOOKUP FAILED
${error.message}
The transfer cannot continue.
Enter 0 to return to the main menu.`,
        'recipientError',
        { recipient: recipientPhone }
      );
    }
  }
  // ==========================================
  // 6. REVIEW TRANSFER
  // ==========================================
  async function reviewTransfer(amountValue) {
    const current = sessions.ewallet;
    if (!current.customer || !current.recipient) {
      showScreen(
        'ewallet',
        'Sender or recipient details are missing.\n\nPlease start again.',
        'ended'
      );
      return;
    }
    showScreen(
      'ewallet',
      'Reviewing your transfer...\n\nPlease wait.',
      'reviewing'
    );
    try {
      const data = await apiRequest('/ewallet/ussd/review', {
        method: 'POST',
        body: JSON.stringify({
          sender_phone: current.mobile,
          recipient_phone: current.recipient,
          amount: Number(amountValue),
        }),
      });
      if (!data.success || !data.review) {
        throw new Error(
          data.message || 'Transfer review was not returned.'
        );
      }
      const review = data.review;
      showScreen(
        'ewallet',
        `TRANSFER REVIEW
TO
${review.recipient_name}
${review.recipient_phone}
Amount: ${money(review.amount, review.currency)}
Current balance:
${money(review.current_balance, review.currency)}
1. Confirm
2. Cancel`,
        'review',
        {
          amount: Number(amountValue),
          review,
          pinAttempts: 0,
          idempotencyKey: crypto.randomUUID(),
        }
      );
    } catch (error) {
      showScreen(
        'ewallet',
        `TRANSFER REVIEW FAILED
${error.message}
No money has been deducted.
Enter 0 to return to the main menu.`,
        'reviewError'
      );
    }
  }
  // ==========================================
  // 7. SUBMIT TRANSFER TO THE CBE SWITCH
  // ==========================================
  async function submitTransfer(pin) {
    const current = sessions.ewallet;
    if (!current.customer || !current.review || !current.idempotencyKey) {
      showScreen(
        'ewallet',
        'Transaction information is missing.\n\nPlease start a new session.',
        'ended'
      );
      return;
    }
    showScreen(
      'ewallet',
      'Processing your transfer...\n\nPlease wait.',
      'processing'
    );
    try {
      const data = await apiRequest('/ewallet/ussd/send', {
        method: 'POST',
        body: JSON.stringify({
          sender_phone: current.mobile,
          recipient_phone: current.recipient,
          amount: current.amount,
          pin,
          idempotency_key: current.idempotencyKey,
        }),
      });
      // Transfer completed.
      if (data.success) {
        showScreen(
          'ewallet',
          `TRANSFER SUCCESSFUL
Sent to: ${data.recipient_name || current.review.recipient_name}
Number: ${current.recipient}
Amount: ${money(data.amount, data.currency)}
New balance:
${money(data.sender_balance, data.currency)}
Reference:
${data.reference}
1. Return to main menu`,
          'transferComplete',
          {
            customer: {
              ...current.customer,
              wallet_balance: data.sender_balance,
            },
            pinAttempts: 0,
          }
        );
        return;
      }
      // The switch refused or failed the transfer.
      const refunded = data.status === 'REVERSED';
      const pending = data.status === 'DEBITED' || data.code === '94';
      const outcome = refunded
        ? 'Your money has been refunded.'
        : pending
          ? 'Please contact support and quote the reference below.'
          : 'No money has been deducted.';
      showScreen(
        'ewallet',
        `TRANSFER FAILED
${data.message}
${outcome}
${data.reference ? `\nReference:\n${data.reference}\n` : ''}
1. Return to main menu`,
        'transferFailed',
        data.sender_balance !== null && data.sender_balance !== undefined
          ? {
              customer: {
                ...current.customer,
                wallet_balance: data.sender_balance,
              },
            }
          : {}
      );
    } catch (error) {
      const wrongPin = error.code === 'INCORRECT_PIN';
      const attempts = current.pinAttempts + 1;
      const remaining = MAX_PIN_ATTEMPTS - attempts;
      if (wrongPin && remaining <= 0) {
        showScreen(
          'ewallet',
          `TRANSACTION CANCELLED
You entered an incorrect PIN three times.
No money was deducted.
The recipient was not credited.
Your session has ended.`,
          'ended',
          { pinAttempts: attempts }
        );
        return;
      }
      const attemptMessage = wrongPin
        ? `Attempts remaining: ${remaining}`
        : '';
      showScreen(
        'ewallet',
        `${error.message}
${attemptMessage}
Enter your 5-digit eWallet transaction PIN:`,
        'transferPin',
        { pinAttempts: attempts }
      );
    }
  }
  // ==========================================
  // 8. MAIN EWALLET MENU AND INPUT
  // ==========================================
  async function handleEwalletInput(value) {
    const entered = value.trim();
    const current = sessions.ewallet;
    switch (current.step) {
      // Enter sender mobile number.
      case 'mobile': {
        const localPhone = normalizePhone(entered);
        if (!localPhone) {
          showScreen(
            'ewallet',
            'Invalid mobile number.\n\nEnter your 8-digit mobile number:',
            'mobile'
          );
          return;
        }
        const fullPhone = formatPhoneNumber(localPhone);
        await checkCustomer(fullPhone);
        return;
      }
      // Unregistered customer voucher menu.
      case 'voucherMenu': {
        if (entered === '1') {
          showScreen(
            'ewallet',
            `VOUCHER INFORMATION
Mobile Number:
${current.voucher.phone_number}
Available Balance:
${money(
              current.voucher.total_available_balance,
              current.voucher.currency
            )}
7. Register for eWallet
0. Exit
Select an option:`,
            'voucherMenu'
          );
          return;
        }
        if (entered === '7') {
          startRegistration();
          return;
        }
        if (entered === '0') {
          showScreen(
            'ewallet',
            'Registration cancelled.\n\nThank you for using Uneswa eWallet.\n\nSession ended.',
            'ended'
          );
          return;
        }
        showScreen(
          'ewallet',
          'Invalid option.\n\n1. View Voucher Information\n7. Register for eWallet\n0. Exit',
          'voucherMenu'
        );
        return;
      }
      // Confirm registration.
      case 'registrationConfirm': {
        if (entered === '1') {
          showScreen(
            'ewallet',
            'REGISTRATION\n\nPlease enter your National ID number:',
            'nationalId'
          );
          return;
        }
        if (entered === '2') {
          showScreen(
            'ewallet',
            `Registration cancelled.
Available Voucher Balance:
${money(
              current.voucher.total_available_balance,
              current.voucher.currency
            )}
7. Register for eWallet
0. Exit`,
            'voucherMenu'
          );
          return;
        }
        showScreen(
          'ewallet',
          'Please select:\n\n1. Yes, Continue\n2. No, Cancel',
          'registrationConfirm'
        );
        return;
      }
      // Collect National ID.
      case 'nationalId': {
        if (entered.length < 5 || entered.length > 30) {
          showScreen(
            'ewallet',
            'Please enter a valid National ID number.',
            'nationalId'
          );
          return;
        }
        showScreen(
          'ewallet',
          'Create your five-digit eWallet transaction PIN:',
          'createRegistrationPin',
          { nationalId: entered }
        );
        return;
      }
      // Create five-digit PIN.
      case 'createRegistrationPin': {
        if (!/^\d{5}$/.test(entered)) {
          showScreen(
            'ewallet',
            'Your PIN must contain exactly five digits.\n\nCreate your PIN:',
            'createRegistrationPin'
          );
          return;
        }
        showScreen(
          'ewallet',
          'Confirm your five-digit transaction PIN:',
          'confirmRegistrationPin',
          { registrationPin: entered }
        );
        return;
      }
      // Confirm five-digit PIN.
      case 'confirmRegistrationPin': {
        if (!/^\d{5}$/.test(entered)) {
          showScreen(
            'ewallet',
            'Your PIN must contain exactly five digits.\n\nConfirm your PIN:',
            'confirmRegistrationPin'
          );
          return;
        }
        if (entered !== current.registrationPin) {
          showScreen(
            'ewallet',
            'The PINs do not match.\n\nPlease create your PIN again:',
            'createRegistrationPin',
            {
              registrationPin: '',
              confirmRegistrationPin: '',
            }
          );
          return;
        }
        // Pass the confirmed PIN directly (state hasn't updated yet).
        await registerCustomer(entered);
        return;
      }
      // Registration failed.
      case 'registrationFailed': {
        if (entered === '1') {
          showScreen(
            'ewallet',
            'Please enter your National ID number:',
            'nationalId',
            {
              nationalId: '',
              registrationPin: '',
              confirmRegistrationPin: '',
            }
          );
          return;
        }
        if (entered === '0') {
          showScreen(
            'ewallet',
            'Registration cancelled.\n\nSession ended.',
            'ended'
          );
          return;
        }
        showScreen(
          'ewallet',
          '1. Try Again\n0. Exit',
          'registrationFailed'
        );
        return;
      }
      // Successful registration.
      case 'registrationSuccess': {
        if (entered === '1') {
          showMainMenu(current.customer);
        } else {
          showScreen(
            'ewallet',
            'Enter 1 to continue to the main menu.',
            'registrationSuccess'
          );
        }
        return;
      }
      // Main menu.
      case 'menu': {
        if (entered === '0') {
          showScreen(
            'ewallet',
            'Thank you for using Uneswa eWallet.\n\nSession ended.',
            'ended'
          );
          return;
        }
        if (entered === '7') {
          if (!current.customer) {
            showScreen(
              'ewallet',
              'Customer details are unavailable.\n\nStart a new session.',
              'ended'
            );
            return;
          }
          showScreen(
            'ewallet',
            `SEND TO MTN MOMO
Available Balance:
${money(
              current.customer.wallet_balance,
              current.customer.currency
            )}
Enter recipient mobile number:`,
            'recipient'
          );
          return;
        }
        if (entered === '8') {
          showScreen(
            'ewallet',
            'The standard Send Money service is not connected in this simulation.\n\nEnter 0 to return to the main menu.',
            'stub'
          );
          return;
        }
        if (entered === '5') {
          showScreen(
            'ewallet',
            'Transaction history is not connected yet.\n\nEnter 0 to return to the main menu.',
            'stub'
          );
          return;
        }
        if (['1', '2', '3', '4'].includes(entered)) {
          showScreen(
            'ewallet',
            'This service is not available in the current simulation.\n\nEnter 0 to return to the main menu.',
            'stub'
          );
          return;
        }
        showMainMenu(current.customer);
        return;
      }
      // Enter recipient mobile number.
      case 'recipient': {
        const localPhone = normalizePhone(entered);
        if (!localPhone) {
          showScreen(
            'ewallet',
            'Invalid mobile number.\n\nEnter recipient mobile number:',
            'recipient'
          );
          return;
        }
        await checkRecipient(formatPhoneNumber(localPhone));
        return;
      }
      case 'recipientError': {
        if (entered === '0') {
          showMainMenu(current.customer);
        } else {
          showScreen(
            'ewallet',
            'Enter 0 to return to the main menu.',
            'recipientError'
          );
        }
        return;
      }
      // Enter transfer amount.
      case 'amount': {
        if (!validAmount(entered)) {
          showScreen(
            'ewallet',
            'Invalid amount.\n\nEnter an amount greater than zero, with no more than two decimal places:',
            'amount'
          );
          return;
        }
        await reviewTransfer(entered);
        return;
      }
      case 'reviewError': {
        if (entered === '0') {
          showMainMenu(current.customer);
        } else {
          showScreen(
            'ewallet',
            'Enter 0 to return to the main menu.',
            'reviewError'
          );
        }
        return;
      }
      // Confirm or cancel transfer.
      case 'review': {
        if (entered === '2') {
          showMainMenu(current.customer);
          return;
        }
        if (entered === '1') {
          showScreen(
            'ewallet',
            'Enter your 5-digit eWallet transaction PIN:',
            'transferPin'
          );
          return;
        }
        showScreen(
          'ewallet',
          'Invalid selection.\n\n1. Confirm\n2. Cancel',
          'review'
        );
        return;
      }
      // Enter transaction PIN.
      case 'transferPin': {
        if (!/^\d{5}$/.test(entered)) {
          showScreen(
            'ewallet',
            'Your transaction PIN must contain exactly five digits.\n\nEnter your PIN:',
            'transferPin'
          );
          return;
        }
        await submitTransfer(entered);
        return;
      }
      case 'transferComplete':
      case 'transferFailed': {
        if (entered === '1') {
          showMainMenu(current.customer);
        } else {
          showScreen(
            'ewallet',
            'Enter 1 to return to the main menu.',
            current.step
          );
        }
        return;
      }
      case 'stub': {
        if (entered === '0') {
          showMainMenu(current.customer);
        } else {
          showScreen(
            'ewallet',
            'Enter 0 to return to the main menu.',
            'stub'
          );
        }
        return;
      }
      default:
        showScreen(
          'ewallet',
          'Session ended.\n\nStart a new session to continue.',
          'ended'
        );
    }
  }
  // ==========================================
  // 9. MTN MOMO USSD MENU FLOW
  // ==========================================

  function showMomoMainMenu(phone) {
    showScreen(
      'momo',
      `MTN MoMo
1) Send Money
2) Approvals
3) PayBills and Electricity
4) Banking
5) Airtime
6) Data&Voice Bundles
7) MoMo Loans
8) My Account
9) Loyalty
# Next`,
      'momoMenu',
      { mobile: phone }
    );
  }

  function showMomoAccountMenu() {
    showScreen(
      'momo',
      `Please select an option:
1) Check Balance
2) Request Mini-Statement
3) Change PIN
4) Pin Reset
5) MomoPay
6) Manage Favorite
7) Change Language
0) Back`,
      'momoAccountMenu'
    );
  }

  async function handleMomoInput(value) {
    const entered = value.trim();
    const current = sessions.momo;

    switch (current.step) {
      case 'mobile': {
        const localPhone = normalizePhone(entered);
        if (!localPhone) {
          showScreen(
            'momo',
            'Invalid mobile number.\n\nEnter your 8-digit mobile number:',
            'mobile'
          );
          return;
        }

        const fullPhone = formatPhoneNumber(localPhone);
        showMomoMainMenu(fullPhone);
        return;
      }

      case 'momoMenu': {
        if (entered === '8') {
          showScreen('momo', 'Please enter your PIN:', 'momoPin');
          return;
        }

        if (entered === '#') {
          showScreen(
            'momo',
            'Additional MTN MoMo services are not configured in this simulation.\n\n0) Back',
            'momoNextMenu'
          );
          return;
        }

        if (entered === '0') {
          showScreen('momo', 'Thank you for using MTN MoMo.\n\nSession ended.', 'ended');
          return;
        }

        if (['1', '2', '3', '4', '5', '6', '7', '9'].includes(entered)) {
          showScreen(
            'momo',
            'This MTN MoMo service is displayed for menu simulation only and is not connected yet.\n\n0) Back to main menu',
            'momoServiceInfo'
          );
          return;
        }

        showMomoMainMenu(current.mobile);
        return;
      }

      case 'momoPin': {
        if (!/^\d{5}$/.test(entered)) {
          showScreen('momo', 'Invalid PIN. Please enter your five-digit PIN:', 'momoPin');
          return;
        }

        try {
          const result = await apiRequest('/momo/verify-pin', {
            method: 'POST',
            body: JSON.stringify({
              phone_number: current.mobile,
              pin: entered,
            }),
          });

          updateSession('momo', {
            momoToken: result.token,
            momoCustomer: result.customer,
            pinAttempts: 0,
          });
          showMomoAccountMenu();
        } catch (error) {
          const message = error.status === 401
            ? 'Incorrect PIN or inactive account.\n\nPlease enter your PIN again:'
            : error.message || 'PIN verification failed. Please try again.';
          showScreen('momo', message, 'momoPin', {
            pinAttempts: current.pinAttempts + 1,
          });
        }
        return;
      }

      case 'momoAccountMenu': {
        if (entered === '0') {
          showMomoMainMenu(current.mobile);
          return;
        }

        if (entered === '1') {
          if (!current.momoToken) {
            showScreen('momo', 'Your session has expired. Please enter your PIN again.', 'momoPin');
            return;
          }

          try {
            const result = await apiRequest('/momo/balance', {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${current.momoToken}`,
              },
            });

            showScreen(
              'momo',
              `MTN MoMo Account\n\nName: ${result.customer.fullname}\nMobile: ${result.customer.phone_number}\nAvailable Balance: SZL ${Number(result.customer.balance).toFixed(2)}\n\n0) Back to My Account`,
              'momoBalance',
              { momoToken: current.momoToken, momoCustomer: result.customer }
            );
          } catch (error) {
            if (error.status === 401) {
              showScreen('momo', 'Your session has expired. Please enter your PIN again.', 'momoPin', {
                momoToken: null,
                momoCustomer: null,
              });
            } else {
              showScreen('momo', error.message || 'Unable to retrieve your balance.\n\n0) Back to My Account', 'momoBalanceError', {
                momoToken: current.momoToken,
              });
            }
          }
          return;
        }

        if (['2', '3', '4', '5', '6', '7'].includes(entered)) {
          const labels = {
            '2': 'Request Mini-Statement',
            '3': 'Change PIN',
            '4': 'PIN Reset',
            '5': 'MoMoPay',
            '6': 'Manage Favourite',
            '7': 'Change Language',
          };
          showScreen(
            'momo',
            `${labels[entered]} is not connected to a backend service yet.\n\n0) Back to My Account`,
            'momoAccountServiceInfo',
            { momoToken: current.momoToken }
          );
          return;
        }

        showMomoAccountMenu();
        return;
      }

      case 'momoBalance':
      case 'momoBalanceError': {
        if (entered === '0') {
          showMomoAccountMenu();
        } else {
          showScreen('momo', 'Enter 0 to return to My Account.', current.step, {
            momoToken: current.momoToken,
          });
        }
        return;
      }

      case 'momoNextMenu':
      case 'momoServiceInfo': {
        if (entered === '0') {
          showMomoMainMenu(current.mobile);
        } else {
          showScreen('momo', 'Enter 0 to return to the MTN MoMo main menu.', current.step);
        }
        return;
      }

      case 'momoAccountServiceInfo': {
        if (entered === '0') {
          showMomoAccountMenu();
        } else {
          showScreen('momo', 'Enter 0 to return to My Account.', 'momoAccountServiceInfo');
        }
        return;
      }

      case 'ended': {
        showScreen(
          'momo',
          'Your MTN MoMo session has ended.\n\nSelect New Session to start again.',
          'ended'
        );
        return;
      }

      default:
        showMomoMainMenu(current.mobile);
    }
  }

  // 10. FORM SUBMISSION
  // ==========================================
  async function handleSubmit(event) {
    event.preventDefault();
    if (!input.trim() || busy) return;
    const value = input.trim();
    // Display the user's input in the terminal.
    updateSession(activeTab, {
      messages: [
        ...session.messages,
        {
          type: 'user',
          text: ['momoPin', 'transferPin', 'createRegistrationPin', 'confirmRegistrationPin'].includes(session.step)
              ? '•••••'
              : value,
        },
      ],
    });
    setInput('');
    setBusy(true);
    try {
      if (activeTab === 'ewallet') {
        await handleEwalletInput(value);
      } else {
        handleMomoInput(value);
      }
    } finally {
      setBusy(false);
    }
  }
  // ==========================================
  // 11. INPUT DISPLAY
  // ==========================================
  function getInputPlaceholder() {
    switch (session.step) {
      case 'mobile':
        return 'Enter your mobile number';
      case 'momoPin':
        return 'Enter your five-digit PIN';
      case 'momoMenu':
      case 'momoAccountMenu':
      case 'momoNextMenu':
      case 'momoServiceInfo':
      case 'momoAccountServiceInfo':
        return 'Select an option';
      case 'recipient':
        return 'Enter recipient mobile number';
      case 'amount':
        return 'Enter amount';
      case 'transferPin':
      case 'createRegistrationPin':
      case 'confirmRegistrationPin':
        return 'Enter five-digit PIN';
      case 'nationalId':
        return 'Enter your National ID';
      case 'menu':
      case 'voucherMenu':
        return 'Select an option';
      case 'registrationConfirm':
        return 'Enter 1 or 2';
      case 'registrationSuccess':
        return 'Enter 1 to continue';
      case 'registrationFailed':
        return 'Enter 1 or 0';
      case 'review':
        return 'Enter 1 or 2';
      case 'transferComplete':
      case 'transferFailed':
        return 'Enter 1 to return to menu';
      default:
        return 'Enter your response';
    }
  }
  const disabledSteps = [
    'ended',
    'information',
    'checkingCustomer',
    'checkingVoucher',
    'checkingRecipient',
    'reviewing',
    'authorizing',
    'processing',
    'registering',
  ];
  const inputDisabled =
    busy || disabledSteps.includes(session.step);
  const numericSteps = [
    'mobile',
    'momoMenu',
    'momoPin',
    'momoAccountMenu',
    'momoNextMenu',
    'momoServiceInfo',
    'momoAccountServiceInfo',
    'momoBalance',
    'momoBalanceError',
    'recipient',
    'amount',
    'transferPin',
    'menu',
    'voucherMenu',
    'registrationConfirm',
    'createRegistrationPin',
    'confirmRegistrationPin',
    'review',
    'transferComplete',
    'transferFailed',
    'registrationSuccess',
    'registrationFailed',
  ];
  // ==========================================
  // 12. USER INTERFACE
  // ==========================================
  return (
    <div className={`app-container theme-${activeTab}`}>
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">U</div>
          <div>
            <p>USSD Simulator</p>
          </div>
        </div>
      </header>
      <main className="simulator">
        <div className="tabs">
          <button
            type="button"
            className={`tab ewallet-tab ${activeTab === 'ewallet' ? 'active' : ''}`}
            onClick={() => setActiveTab('ewallet')}
          >
            <span className="tab-icon"></span>
            Uneswa eWallet
          </button>
          <button
            type="button"
            className={`tab momo-tab ${activeTab === 'momo' ? 'active' : ''}`}
            onClick={() => setActiveTab('momo')}
          >
            <span className="tab-icon"></span>
            MTN MoMo
          </button>
        </div>
        <div className="simulator-content">
          <div className="section-heading">
            <div>
              <h2>
                {activeTab === 'ewallet'
                  ? 'Uneswa eWallet'
                  : 'MTN Mobile Money'}
              </h2>
              <p>
                Dial <strong>{SHORT_CODES[activeTab]}</strong> to access the service.
              </p>
            </div>
            <div className="network-status">
              <span className="status-dot"></span>
              Backend integration
            </div>
          </div>
          <div className="ussd-display">
            <div className="display-top">
              <span>{SHORT_CODES[activeTab]}</span>
              <span>USSD SESSION</span>
            </div>
            <div className="display-messages" ref={displayRef}>
              {session.messages.map((message, index) => (
                <div
                  key={`${activeTab}-${index}`}
                  className={`message ${
                    message.type === 'user'
                      ? 'user-message'
                      : 'system-message'
                  }`}
                >
                  <span className="message-label">
                    {message.type === 'user'
                      ? 'You'
                      : activeTab === 'ewallet'
                        ? 'UNESWA eWALLET'
                        : 'MTN MoMo'}
                  </span>
                  <div className="message-text">
                    {message.text}
                  </div>
                </div>
              ))}
              {busy && (
                <div className="message system-message">
                  <span className="message-label">SYSTEM</span>
                  <div className="message-text">Processing...</div>
                </div>
              )}
            </div>
          </div>
          <form
            className="response-form"
            onSubmit={handleSubmit}
          >
            <label htmlFor="ussd-response">
              Response
            </label>
            <div className="input-row">
              <input
                id="ussd-response"
                type={['momoPin', 'transferPin', 'createRegistrationPin', 'confirmRegistrationPin'].includes(session.step) ? 'password' : 'text'}
                value={input}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  if (numericSteps.includes(session.step)) {
                    const validNextValue =
                      session.step === 'momoMenu'
                        ? /^\d*#?$/.test(nextValue)
                        : /^\d*(\.\d*)?$/.test(nextValue);
                    if (validNextValue) {
                      setInput(nextValue);
                    }
                  } else {
                    setInput(nextValue);
                  }
                }}
                placeholder={getInputPlaceholder()}
                disabled={inputDisabled}
                autoComplete="off"
              />
              <button
                type="submit"
                className="send-button"
                disabled={!input.trim() || inputDisabled}
              >
                {busy ? 'Please wait...' : 'Send'}
              </button>
            </div>
            {session.step === 'mobile' && (
              <small>
                Enter your local mobile number.
              </small>
            )}
            {session.step === 'recipient' && (
              <small>
                Enter recipient mobile number.
              </small>
            )}
            {session.step === 'nationalId' && (
              <small>
                Enter your National ID number.
              </small>
            )}
            {[
              'transferPin',
              'createRegistrationPin',
              'confirmRegistrationPin',
              'momoPin',
            ].includes(session.step) && (
              <small>
                Enter your five-digit PIN.
              </small>
            )}
          </form>
          <div className="session-actions">
            <div className="session-buttons">
              <button
                type="button"
                className="reset-button"
                onClick={resetCurrentSession}
              >
                ↻ New Session
              </button>
              <button
                type="button"
                className="reset-button"
                onClick={resetAllSessions}
              >
                Reset Sessions
              </button>
            </div>
          </div>
        </div>
      </main>
      <footer className="app-footer">
        <p>USSD Simulation</p>
        <p>
          Demonstration environment — no real money is transferred.
        </p>
      </footer>
    </div>
  );
}
export default App;