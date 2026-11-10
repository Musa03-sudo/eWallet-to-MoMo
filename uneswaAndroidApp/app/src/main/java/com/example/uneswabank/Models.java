
package com.example.uneswabank;

import com.google.gson.annotations.SerializedName;

public class Models {

    // =====================================================
    // 1. LOGIN
    // =====================================================

    public static class LoginRequest {
        public String identifier;
        public String password;

        public LoginRequest(String identifier, String password) {
            this.identifier = identifier;
            this.password = password;
        }
    }

    public static class LoginResponse {
        public boolean success;
        public String message;
        public String token;

        @SerializedName("customer")
        public Account customer;
    }

    // =====================================================
    // 2. CUSTOMER ACCOUNT
    // =====================================================

    public static class Account {
        @SerializedName("account_number")
        public String accountNumber;

        @SerializedName("full_name")
        public String fullName;

        public String email;
        public String cellphone;
        public double balance;
        public String currency;
        public String status;
    }

    // =====================================================
    // 3. ACCOUNT RESPONSE
    // =====================================================

    public static class AccountResponse {
        public boolean success;
        public String message;
        public Account account;
    }

    // =====================================================
    // 4. LOGOUT
    // =====================================================

    public static class LogoutResponse {
        public boolean success;
        public String message;
    }

    // =====================================================
    // 5. EWALLET REQUEST
    // =====================================================

    public static class EwalletRequest {

        @SerializedName("recipient_cellphone")
        public String recipientCellphone;

        public double amount;

        @SerializedName("send_pin")
        public boolean sendPin;

        public EwalletRequest(
                String recipientCellphone,
                double amount,
                boolean sendPin) {

            this.recipientCellphone = recipientCellphone;
            this.amount = amount;
            this.sendPin = sendPin;
        }
    }

    // =====================================================
    // 6. EWALLET REVIEW RESPONSE
    // =====================================================

    public static class ReviewResponse {

        @SerializedName("success")
        public boolean success;

        @SerializedName("message")
        public String message;

        @SerializedName("recipient_registered")
        public boolean recipientRegistered;

        @SerializedName("recipient")
        public RecipientInfo recipient;

        @SerializedName("from_account")
        public String fromAccount;

        @SerializedName("from_name")
        public String fromName;

        @SerializedName("recipient_cellphone")
        public String recipientCellphone;

        @SerializedName("amount")
        public double amount;

        @SerializedName("currency")
        public String currency;

        @SerializedName("send_pin")
        public boolean sendPin;

        @SerializedName("balance_after")
        public double balanceAfter;
    }

    // =====================================================
    // 7. EWALLET SEND RESPONSE
    // =====================================================

    public static class SendResponse {

        public boolean success;
        public String message;

        @SerializedName("registered")
        public boolean registered;

        @SerializedName("transaction_type")
        public String transactionType;

        @SerializedName("reference_number")
        public String referenceNumber;

        @SerializedName("voucher_generated")
        public boolean voucherGenerated;

        public Sender sender;
        public Recipient recipient;
        public Voucher voucher;
        public Sms sms;
    }

    // =====================================================
    // 8. SENDER DETAILS
    // =====================================================

    public static class Sender {

        @SerializedName("account_number")
        public String accountNumber;

        public String name;

        @SerializedName("new_balance")
        public double newBalance;

        public String currency;
    }

    // =====================================================
    // 9. RECIPIENT DETAILS
    // =====================================================

    public static class Recipient {

        @SerializedName("phone_number")
        public String phoneNumber;

        public String name;
        public String surname;

        @SerializedName("credited_amount")
        public double creditedAmount;

        @SerializedName("new_wallet_balance")
        public double newWalletBalance;

        public String currency;
    }

    // =====================================================
    // 10. VOUCHER DETAILS
    // =====================================================

    public static class Voucher {

        @SerializedName("voucher_code")
        public String voucherCode;

        @SerializedName("recipient_cellphone")
        public String recipientCellphone;

        public String amount;

        @SerializedName("remaining_balance")
        public String remainingBalance;

        public String currency;
        public String status;

        // Returned in the SMS preview for development.
        // Do not log or expose this in production.
        public String pin;
    }

    // =====================================================
    // 11. SMS PREVIEW
    // =====================================================

    public static class Sms {

        public boolean sent;

        public String preview;

        @SerializedName("sender_preview")
        public String senderPreview;

        @SerializedName("recipient_preview")
        public String recipientPreview;

        public String message;
    }

    // =====================================================
    // 12. BANK TRANSFER REQUEST
    // =====================================================

    public static class TransferRequest {

        @SerializedName("to_account_number")
        public String toAccountNumber;

        public double amount;

        public TransferRequest(
                String toAccountNumber,
                double amount) {

            this.toAccountNumber = toAccountNumber;
            this.amount = amount;
        }
    }

    // =====================================================
    // 13. BANK TRANSFER RESPONSE
    // =====================================================

    public static class TransferResponse {

        public boolean success;
        public String message;

        @SerializedName("to_account_number")
        public String toAccountNumber;

        @SerializedName("to_name")
        public String toName;

        public double amount;
        public String currency;

        @SerializedName("new_balance")
        public double newBalance;

        @SerializedName("transaction_number")
        public String transactionNumber;
    }

    // =====================================================
    // 14. API ERROR RESPONSE
    // =====================================================

    public static class ErrorResponse {
        public boolean success;
        public String error;
        public String message;
    }
    public static class RecipientCheckRequest {

        @SerializedName("recipient_phone")
        public String recipientPhone;

        public RecipientCheckRequest(String recipientPhone) {
            this.recipientPhone = recipientPhone;
        }
    }

    public static class RecipientCheckResponse {

        public boolean success;
        public boolean registered;
        public String message;

        @SerializedName("recipient_phone")
        public String recipientPhone;

        public String name;
        public String surname;
    }
    public static class RecipientInfo {

        @SerializedName("phone_number")
        public String phoneNumber;

        @SerializedName("name")
        public String name;

        @SerializedName("surname")
        public String surname;
    }
}
