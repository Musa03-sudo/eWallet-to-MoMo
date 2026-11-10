
package com.example.uneswabank;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;

import java.text.DecimalFormat;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class ConfirmActivity extends AppCompatActivity {

    private TextView tvFrom;
    private TextView tvTo;
    private TextView tvAmount;
    private TextView tvBalanceAfter;
    private TextView tvPinSent;
    private TextView tvCustomerName;

    private TextView tvSuccessSummary;
    private TextView tvResultCodeLabel;
    private TextView tvVoucherCode;
    private TextView tvSmsLabel;
    private TextView tvSms;
    private TextView tvNewBalance;

    private TextView tvError;
    private ProgressBar progress;
    private Button btnConfirm;

    private View layoutReview;
    private View layoutSuccess;

    private SessionManager session;

    private Call<Models.SendResponse> sendCall;

    private String recipientCellphone;
    private double amount;
    private String currency;
    private boolean sendPin;
    private boolean recipientRegistered;
    private String recipientName;
    private double balanceAfter;

    private boolean paymentSuccessful = false;
    private boolean requestInProgress = false;

    private final DecimalFormat moneyFormat =
            new DecimalFormat("#,##0.00");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_confirm);

        session = new SessionManager(this);

        initializeViews();
        readIntentData();
        displayReview();

        // Handle the header back arrow.
        View btnBack = findViewById(R.id.btnBack);

        btnBack.setOnClickListener(v -> {

            if (requestInProgress) {
                Toast.makeText(
                        ConfirmActivity.this,
                        "Please wait while the transaction is being processed.",
                        Toast.LENGTH_SHORT
                ).show();

                return;
            }

            finish();
        });

        // AndroidX-compatible back button and gesture handling.
        getOnBackPressedDispatcher().addCallback(
                this,
                new OnBackPressedCallback(true) {
                    @Override
                    public void handleOnBackPressed() {

                        if (requestInProgress) {
                            Toast.makeText(
                                    ConfirmActivity.this,
                                    "Please wait while the transaction is being processed.",
                                    Toast.LENGTH_SHORT
                            ).show();
                            return;
                        }

                        // Do not return to the confirmation screen
                        // after a successful transaction.
                        finish();
                    }
                }
        );

        btnConfirm.setOnClickListener(v -> {
            if (paymentSuccessful) {
                finish();
            } else {
                confirmPayment();
            }
        });
    }

    private void initializeViews() {

        layoutReview = findViewById(R.id.layoutReview);
        layoutSuccess = findViewById(R.id.layoutSuccess);

        tvFrom = findViewById(R.id.tvFrom);
        tvTo = findViewById(R.id.tvTo);
        tvCustomerName = findViewById(R.id.tvCustomerName);
        tvAmount = findViewById(R.id.tvAmount);
        tvBalanceAfter = findViewById(R.id.tvBalanceAfter);
        tvPinSent = findViewById(R.id.tvPinSent);

        tvSuccessSummary = findViewById(R.id.tvSuccessSummary);
        tvResultCodeLabel = findViewById(R.id.tvResultCodeLabel);
        tvVoucherCode = findViewById(R.id.tvVoucherCode);
        tvSmsLabel = findViewById(R.id.tvSmsLabel);
        tvSms = findViewById(R.id.tvSms);
        tvNewBalance = findViewById(R.id.tvNewBalance);

        tvError = findViewById(R.id.tvError);
        progress = findViewById(R.id.progress);
        btnConfirm = findViewById(R.id.btnConfirm);

        layoutSuccess.setVisibility(View.GONE);
        layoutReview.setVisibility(View.VISIBLE);

        progress.setVisibility(View.GONE);
        tvError.setVisibility(View.GONE);
    }

    private void readIntentData() {

        Intent intent = getIntent();

        recipientCellphone =
                intent.getStringExtra("recipientCellphone");

        amount = intent.getDoubleExtra("amount", 0.0);

        currency = intent.getStringExtra("currency");

        sendPin = intent.getBooleanExtra("sendPin", false);

        recipientRegistered =
                intent.getBooleanExtra("recipientRegistered", false);

        recipientName =
                intent.getStringExtra("recipientName");

        balanceAfter =
                intent.getDoubleExtra("balanceAfter", 0.0);

        if (currency == null || currency.trim().isEmpty()) {
            currency = "SZL";
        }

        if (recipientCellphone == null) {
            recipientCellphone = "";
        }

        if (recipientName == null) {
            recipientName = "";
        }
    }

    /**
     * Opens ConfirmActivity and passes the transaction review details.
     */
    public static void start(
            Context context,
            Models.ReviewResponse review
    ) {

        Intent intent = new Intent(context, ConfirmActivity.class);

        intent.putExtra(
                "recipientCellphone",
                review.recipientCellphone
        );

        intent.putExtra("amount", review.amount);
        intent.putExtra("currency", review.currency);
        intent.putExtra("sendPin", review.sendPin);

        intent.putExtra(
                "recipientRegistered",
                review.recipientRegistered
        );
        String fullName = "";

        if (review.recipient != null) {

            String name = review.recipient.name != null
                    ? review.recipient.name.trim()
                    : "";

            String surname = review.recipient.surname != null
                    ? review.recipient.surname.trim()
                    : "";

            fullName = (name + " " + surname).trim();
        }

        intent.putExtra("recipientName", fullName);

        intent.putExtra(
                "balanceAfter",
                review.balanceAfter
        );

        context.startActivity(intent);
    }

    /**
     * Displays transaction information before confirmation.
     */
    private void displayReview() {

        tvFrom.setText("Your bank account");

        // Recipient phone number
        tvTo.setText(recipientCellphone);

        // Recipient's registered name
        if (recipientRegistered && !recipientName.trim().isEmpty()) {
            tvCustomerName.setText(recipientName);
        } else if (recipientRegistered) {
            tvCustomerName.setText("Name unavailable");
        } else {
            tvCustomerName.setText("Not registered");
        }

        // Recipient type
        if (recipientRegistered) {
            tvPinSent.setText("Registered eWallet customer");
        } else {
            tvPinSent.setText("Unregistered recipient (Voucher)");
        }

        tvAmount.setText(
                currency + " " + moneyFormat.format(amount)
        );

        tvBalanceAfter.setText(
                currency + " " + moneyFormat.format(balanceAfter)
        );
    }
    /**
     * Sends the transaction request to the backend.
     */
    private void confirmPayment() {

        if (requestInProgress || paymentSuccessful) {
            return;
        }

        if (recipientCellphone.trim().isEmpty() || amount <= 0) {
            showError(
                    "Invalid transaction details. Please go back and try again."
            );
            return;
        }

        requestInProgress = true;
        setLoading(true);

        tvError.setVisibility(View.GONE);

        Models.EwalletRequest request =
                new Models.EwalletRequest(
                        recipientCellphone,
                        amount,
                        sendPin
                );

        sendCall = ApiClient.getApiService().ewalletSend(
                session.getAuthHeader(),
                request
        );

        sendCall.enqueue(new Callback<Models.SendResponse>() {

            @Override
            public void onResponse(
                    Call<Models.SendResponse> call,
                    Response<Models.SendResponse> response
            ) {

                if (isFinishing() || isDestroyed()) {
                    return;
                }

                requestInProgress = false;
                setLoading(false);

                if (response.isSuccessful()
                        && response.body() != null) {

                    Models.SendResponse result = response.body();

                    if (result.success) {

                        if (result.sender == null) {
                            showError(
                                    "The transaction response is incomplete. " +
                                            "Please check your account balance before retrying."
                            );
                            return;
                        }

                        paymentSuccessful = true;

                        updateSenderBalance(
                                result.sender.newBalance
                        );

                        showSuccess(result);

                    } else {

                        showError(
                                result.message != null
                                        ? result.message
                                        : "Transaction could not be completed."
                        );
                    }

                } else {

                    showError(
                            "Transaction failed. Server returned HTTP "
                                    + response.code() + "."
                    );
                }
            }

            @Override
            public void onFailure(
                    Call<Models.SendResponse> call,
                    Throwable t
            ) {

                if (isFinishing() || isDestroyed()) {
                    return;
                }

                requestInProgress = false;
                setLoading(false);

                if (call.isCanceled()) {
                    return;
                }

                showError(
                        "Unable to contact the server. Check your connection. " +
                                "Verify the transaction status before trying again."
                );
            }
        });
    }

    /**
     * Updates the bank balance stored in the Android session.
     * newBalance is a double in the Sender model.
     */
    private void updateSenderBalance(double newBalance) {

        session.setBalance(newBalance);
    }

    /**
     * Displays the appropriate successful transaction result.
     */
    private void showSuccess(Models.SendResponse result) {

        layoutReview.setVisibility(View.GONE);
        layoutSuccess.setVisibility(View.VISIBLE);

        btnConfirm.setText("Done");
        btnConfirm.setEnabled(true);

        if (result.registered) {

            // REGISTERED EWALLET RECIPIENT.
            // No voucher code or voucher PIN is generated.

            tvSuccessSummary.setText(
                    "Your transfer was successful. The funds have been " +
                            "credited directly to the recipient's eWallet."
            );

            tvResultCodeLabel.setText("Transaction reference");

            tvVoucherCode.setText(
                    result.referenceNumber != null
                            ? result.referenceNumber
                            : "Not available"
            );

            tvSmsLabel.setText("Recipient wallet details");

            if (result.recipient != null) {

                String recipientDetails =
                        "Recipient: "
                                + safeText(result.recipient.name)
                                + " "
                                + safeText(result.recipient.surname)
                                + "\nPhone: "
                                + safeText(result.recipient.phoneNumber)
                                + "\nAmount credited: "
                                + safeText(result.recipient.currency)
                                + " "
                                + safeText(result.recipient.creditedAmount);

                tvSms.setText(recipientDetails);

                tvSms.setText(recipientDetails);

            } else {

                tvSms.setText(
                        "The recipient's eWallet has been credited successfully."
                );
            }

        } else {

            // UNREGISTERED RECIPIENT.
            // A voucher is generated for ATM/agent redemption.

            tvSuccessSummary.setText(
                    "Your transfer was successful. A voucher has been " +
                            "generated for the recipient."
            );

            tvResultCodeLabel.setText("Voucher code");

            if (result.voucher != null) {

                tvVoucherCode.setText(
                        result.voucher.voucherCode != null
                                ? result.voucher.voucherCode
                                : "Not available"
                );

            } else {

                tvVoucherCode.setText("Not available");
            }

            tvSmsLabel.setText(
                    "Message to recipient (simulated SMS)"
            );

            if (result.sms != null && result.sms.preview != null) {

                tvSms.setText(result.sms.preview);

            } else if (result.sms != null
                    && result.sms.senderPreview != null) {

                tvSms.setText(result.sms.senderPreview);

            } else {

                tvSms.setText(
                        "Voucher generated successfully. " +
                                "SMS delivery is not configured."
                );
            }
        }

        if (result.sender != null) {

            tvNewBalance.setText(
                    result.sender.currency + " "
                            + result.sender.newBalance
            );

        } else {

            tvNewBalance.setText("Updated");
        }
    }

    /**
     * Safely converts nullable response values to text.
     */
    private String safeText(Object value) {

        return value == null ? "" : String.valueOf(value);
    }

    private void setLoading(boolean loading) {

        progress.setVisibility(
                loading ? View.VISIBLE : View.GONE
        );

        btnConfirm.setEnabled(!loading);

        if (loading) {
            btnConfirm.setText("Processing...");
        } else if (!paymentSuccessful) {
            btnConfirm.setText("Confirm Payment");
        }
    }

    private void showError(String message) {

        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);

        Toast.makeText(
                this,
                message,
                Toast.LENGTH_LONG
        ).show();
    }

    @Override
    protected void onDestroy() {

        if (sendCall != null && !sendCall.isCanceled()) {
            sendCall.cancel();
        }

        super.onDestroy();
    }
}
