
package com.example.uneswabank;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.Button;

import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.textfield.TextInputEditText;

import java.math.BigDecimal;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * eWallet screen.
 *
 * Allows a logged-in customer to:
 * 1. Enter a recipient cellphone number.
 * 2. Enter an amount.
 * 3. Choose whether to include a simulated PIN notification.
 * 4. Review the payment before confirmation.
 */
public class EwalletActivity extends AppCompatActivity {

    private SessionManager session;

    // Sender information
    private TextView tvFromName;
    private TextView tvFromBalance;

    // Input fields
    private TextInputEditText etRecipient;
    private TextInputEditText etAmount;

    // Options and messages

    private TextView tvError;
    private ProgressBar progress;
    private Button btnSend;

    private Call<Models.ReviewResponse> reviewCall;
    private Call<Models.AccountResponse> accountCall;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setContentView(R.layout.activity_ewallet);

        View btnBack = findViewById(R.id.btnBack);

        btnBack.setOnClickListener(v -> finish());

        // Setup screen header
        UiUtil.setupHeader(this, "eWallet");

        // Initialize session
        session = new SessionManager(this);

        // Check whether customer is logged in
        if (!session.isLoggedIn()) {
            redirectToLogin();
            return;
        }

        // Initialize views
        initializeViews();

        // Display saved sender details
        showFromDetails();

        // Continue button
        btnSend.setOnClickListener(v -> reviewPayment());

    }

    @Override
    protected void onResume() {
        super.onResume();

        if (session != null && session.isLoggedIn()) {
            loadAccountDetails();
        }
    }

    // =====================================================
    // 1. INITIALIZE VIEWS
    // =====================================================

    private void initializeViews() {

        tvFromName = findViewById(R.id.tvFromName);
        tvFromBalance = findViewById(R.id.tvFromBalance);

        etRecipient = findViewById(R.id.etRecipient);
        etAmount = findViewById(R.id.etAmount);



        tvError = findViewById(R.id.tvError);
        progress = findViewById(R.id.progress);
        btnSend = findViewById(R.id.btnSend);
    }


    // =====================================================
    // 2. DISPLAY SENDER DETAILS
    // =====================================================

    private void showFromDetails() {

        tvFromName.setText(session.getFullName());

        tvFromBalance.setText(
                session.getBalanceText()
        );
    }


    // =====================================================
    // 3. LOAD UPDATED ACCOUNT DETAILS
    // =====================================================

    private void loadAccountDetails() {

        accountCall = ApiClient.getApiService()
                .getAccount(session.getAuthHeader());

        accountCall.enqueue(new Callback<Models.AccountResponse>() {

            @Override
            public void onResponse(
                    Call<Models.AccountResponse> call,
                    Response<Models.AccountResponse> response) {

                if (isFinishing() || isDestroyed()) {
                    return;
                }

                if (response.code() == 401) {
                    redirectToLogin();
                    return;
                }

                if (response.isSuccessful()
                        && response.body() != null
                        && response.body().account != null) {

                    Models.Account account =
                            response.body().account;

                    // Update locally saved balance
                    session.setBalance(account.balance);

                    // Update sender information
                    tvFromName.setText(account.fullName);

                    tvFromBalance.setText(
                            UiUtil.money(
                                    account.currency,
                                    account.balance
                            )
                    );
                }
            }

            @Override
            public void onFailure(
                    Call<Models.AccountResponse> call,
                    Throwable t) {

                if (!call.isCanceled()
                        && !isFinishing()
                        && !isDestroyed()) {

                    // Continue displaying saved account details
                    showFromDetails();
                }
            }
        });
    }


    // =====================================================
    // 4. REVIEW PAYMENT
    // POST /api/ewallet/review
    // =====================================================

    private void reviewPayment() {

        hideKeyboard();

        tvError.setText("");
        tvError.setVisibility(View.GONE);

        // Read input values
        String cellphone = getText(etRecipient);
        String amountText = getText(etAmount);

        // Validate cellphone
        if (!validateCellphone(cellphone)) {

            showError(
                    "Enter a valid 11-digit cellphone number beginning with 268."
            );

            etRecipient.requestFocus();
            return;
        }

        // Validate amount
        if (!validateAmount(amountText)) {

            showError(
                    "Enter a valid amount greater than zero with a maximum of two decimal places."
            );

            etAmount.requestFocus();
            return;
        }

        BigDecimal amountDecimal;

        try {
            amountDecimal = new BigDecimal(amountText);
        } catch (NumberFormatException e) {

            showError("Invalid payment amount.");
            return;
        }

        double amount = amountDecimal.doubleValue();

        // Prevent sending money to the same customer
        // if the recipient number is also registered as the sender's number.
        // Recipient account lookup is not implemented in this prototype.

        // Create review request
        Models.EwalletRequest request =
                new Models.EwalletRequest(
                        cellphone,
                        amount,
                        true
                );

        // Start loading
        setLoading(true);

        // Call backend review endpoint
        reviewCall = ApiClient.getApiService()
                .ewalletReview(
                        session.getAuthHeader(),
                        request
                );

        reviewCall.enqueue(new Callback<Models.ReviewResponse>() {

            @Override
            public void onResponse(
                    Call<Models.ReviewResponse> call,
                    Response<Models.ReviewResponse> response) {

                if (isFinishing() || isDestroyed()) {
                    return;
                }

                setLoading(false);

                // Session expired
                if (response.code() == 401) {

                    redirectToLogin();
                    return;
                }

                // Successful HTTP response
                if (response.isSuccessful()
                        && response.body() != null) {

                    Models.ReviewResponse review =
                            response.body();

                    if (review.success) {

                        if (review.recipientCellphone == null
                                || review.recipientCellphone.isEmpty()) {

                            showError(
                                    "The server returned incomplete payment details."
                            );
                            return;
                        }

                        // Open confirmation screen
                        ConfirmActivity.start(
                                EwalletActivity.this,
                                review
                        );

                    } else {

                        showError(
                                review.message != null
                                        ? review.message
                                        : "Unable to review payment."
                        );
                    }

                } else {

                    // Display actual backend error
                    showError(
                            readErrorMessage(
                                    response,
                                    "Unable to review payment."
                            )
                    );
                }
            }

            @Override
            public void onFailure(
                    Call<Models.ReviewResponse> call,
                    Throwable t) {

                if (isFinishing() || isDestroyed()) {
                    return;
                }

                setLoading(false);

                if (call.isCanceled()) {
                    return;
                }

                android.util.Log.e(
                        "EWALLET_REVIEW",
                        "Review request failed",
                        t
                );

                showError(
                        "Cannot connect to the banking server. "
                                + "Please check your connection and try again."
                );
            }
        });
    }


    // =====================================================
    // 5. VALIDATE CELLPHONE
    // =====================================================

    private boolean validateCellphone(String cellphone) {

        // Eswatini format: 268 + 8 digits
        return cellphone.matches("^268\\d{8}$");
    }


    // =====================================================
    // 6. VALIDATE AMOUNT
    // =====================================================

    private boolean validateAmount(String amountText) {

        try {

            BigDecimal amount = new BigDecimal(amountText);

            return amount.compareTo(BigDecimal.ZERO) > 0
                    && amount.scale() <= 2;

        } catch (NumberFormatException e) {

            return false;
        }
    }


    // =====================================================
    // 7. LOADING INDICATOR
    // =====================================================

    private void setLoading(boolean loading) {

        progress.setVisibility(
                loading ? View.VISIBLE : View.GONE
        );

        btnSend.setEnabled(!loading);

        etRecipient.setEnabled(!loading);
        etAmount.setEnabled(!loading);


        btnSend.setText(
                loading ? "Please wait..." : "Continue"
        );
    }


    // =====================================================
    // 8. DISPLAY ERROR
    // =====================================================

    private void showError(String message) {

        tvError.setText(message);
        tvError.setVisibility(View.VISIBLE);
    }


    // =====================================================
    // 9. READ BACKEND ERROR
    // =====================================================

    private String readErrorMessage(
            Response<?> response,
            String defaultMessage) {

        try {

            if (response.errorBody() != null) {

                String errorBody =
                        response.errorBody().string();

                org.json.JSONObject json =
                        new org.json.JSONObject(errorBody);

                if (json.has("message")) {
                    return json.getString("message");
                }

                if (json.has("error")) {
                    return json.getString("error");
                }
            }

        } catch (Exception e) {

            android.util.Log.e(
                    "EWALLET_REVIEW",
                    "Unable to read backend error",
                    e
            );
        }

        return defaultMessage
                + " (HTTP "
                + response.code()
                + ")";
    }


    // =====================================================
    // 10. GET INPUT TEXT
    // =====================================================

    private String getText(TextInputEditText input) {

        if (input.getText() == null) {
            return "";
        }

        return input.getText()
                .toString()
                .trim();
    }


    // =====================================================
    // 11. HIDE KEYBOARD
    // =====================================================

    private void hideKeyboard() {

        View view = getCurrentFocus();

        if (view != null) {

            InputMethodManager manager =
                    (InputMethodManager) getSystemService(
                            Context.INPUT_METHOD_SERVICE
                    );

            if (manager != null) {
                manager.hideSoftInputFromWindow(
                        view.getWindowToken(),
                        0
                );
            }

            view.clearFocus();
        }
    }


    // =====================================================
    // 12. REDIRECT TO LOGIN
    // =====================================================

    private void redirectToLogin() {

        session.clear();

        Intent intent = new Intent(
                EwalletActivity.this,
                LoginActivity.class
        );

        intent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TASK
        );

        startActivity(intent);
        finish();
    }


    // =====================================================
    // 13. CLEAN UP REQUESTS
    // =====================================================

    @Override
    protected void onDestroy() {

        if (reviewCall != null) {
            reviewCall.cancel();
        }

        if (accountCall != null) {
            accountCall.cancel();
        }

        super.onDestroy();
    }
}
