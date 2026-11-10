
package com.example.uneswabank;

import android.os.Bundle;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.dialog.MaterialAlertDialogBuilder;
import com.google.android.material.textfield.TextInputEditText;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Account-to-account transfer using POST /api/transfer.
 */
public class TransferActivity extends AppCompatActivity {

    private SessionManager session;

    private TextView tvFromName;
    private TextView tvFromBalance;
    private TextView tvError;
    private TextView tvSuccess;

    private TextInputEditText etToAccount;
    private TextInputEditText etAmount;

    private MaterialButton btnTransfer;
    private ProgressBar progress;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_transfer);

        UiUtil.setupHeader(this, "Transfer");

        session = new SessionManager(this);

        initializeViews();

        btnTransfer.setOnClickListener(v -> askToConfirm());
    }

    private void initializeViews() {

        tvFromName = findViewById(R.id.tvFromName);
        tvFromBalance = findViewById(R.id.tvFromBalance);
        tvError = findViewById(R.id.tvError);
        tvSuccess = findViewById(R.id.tvSuccess);

        etToAccount = findViewById(R.id.etToAccount);
        etAmount = findViewById(R.id.etAmount);

        btnTransfer = findViewById(R.id.btnTransfer);
        progress = findViewById(R.id.progress);
    }

    @Override
    protected void onResume() {
        super.onResume();
        showFrom();
    }

    private void showFrom() {

        tvFromName.setText(
                session.getFullName()
                        + " ("
                        + session.getAccountNumber()
                        + ")"
        );

        tvFromBalance.setText(
                "Available " + session.getBalanceText()
        );
    }

    private void askToConfirm() {

        UiUtil.hideKeyboard(this);

        tvError.setVisibility(View.GONE);
        tvSuccess.setVisibility(View.GONE);

        String destinationAccount = UiUtil.textOf(etToAccount);
        String amountText = UiUtil.textOf(etAmount);

        if (destinationAccount.isEmpty()) {
            UiUtil.showError(
                    tvError,
                    "Enter the destination account number"
            );
            etToAccount.requestFocus();
            return;
        }

        if (destinationAccount.equals(session.getAccountNumber())) {
            UiUtil.showError(
                    tvError,
                    "You cannot transfer money to your own account"
            );
            etToAccount.requestFocus();
            return;
        }

        if (amountText.isEmpty()) {
            UiUtil.showError(tvError, "Enter the transfer amount");
            etAmount.requestFocus();
            return;
        }

        double amount;

        try {
            amount = Double.parseDouble(amountText);
        } catch (NumberFormatException e) {
            UiUtil.showError(tvError, "Enter a valid amount");
            etAmount.requestFocus();
            return;
        }

        if (Double.isNaN(amount)
                || Double.isInfinite(amount)
                || amount <= 0) {

            UiUtil.showError(
                    tvError,
                    "Amount must be greater than zero"
            );
            etAmount.requestFocus();
            return;
        }

        if (amountText.matches(".*\\.\\d{3,}")) {
            UiUtil.showError(
                    tvError,
                    "Amount can have a maximum of two decimal places"
            );
            etAmount.requestFocus();
            return;
        }

        final double finalAmount = amount;

        new MaterialAlertDialogBuilder(this)
                .setTitle("Confirm transfer")
                .setMessage(
                        "Transfer "
                                + UiUtil.money(
                                session.getCurrency(),
                                finalAmount
                        )
                                + " to account "
                                + destinationAccount
                                + "?"
                )
                .setNegativeButton("Cancel", null)
                .setPositiveButton(
                        "Confirm",
                        (dialog, which) ->
                                transfer(destinationAccount, finalAmount)
                )
                .show();
    }

    private void transfer(String destinationAccount, double amount) {

        setLoading(true);

        Models.TransferRequest request =
                new Models.TransferRequest(
                        destinationAccount,
                        amount
                );

        ApiClient.getApiService()
                .transfer(session.getAuthHeader(), request)
                .enqueue(new Callback<Models.TransferResponse>() {

                    @Override
                    public void onResponse(
                            @NonNull Call<Models.TransferResponse> call,
                            @NonNull Response<Models.TransferResponse> response) {

                        setLoading(false);

                        if (response.code() == 401) {
                            session.clear();

                            android.content.Intent intent =
                                    new android.content.Intent(
                                            TransferActivity.this,
                                            LoginActivity.class
                                    );

                            intent.setFlags(
                                    android.content.Intent.FLAG_ACTIVITY_NEW_TASK
                                            | android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK
                            );

                            startActivity(intent);
                            finish();
                            return;
                        }

                        if (response.isSuccessful()
                                && response.body() != null
                                && response.body().success) {

                            Models.TransferResponse result =
                                    response.body();

                            session.setBalance(result.newBalance);

                            showFrom();

                            etToAccount.setText("");
                            etAmount.setText("");

                            tvSuccess.setText(
                                    UiUtil.money(
                                            result.currency,
                                            result.amount
                                    )
                                            + " sent to "
                                            + result.toName
                                            + ".\nNew balance: "
                                            + UiUtil.money(
                                            result.currency,
                                            result.newBalance
                                    )
                            );

                            tvSuccess.setVisibility(View.VISIBLE);

                        } else {

                            UiUtil.showApiError(
                                    TransferActivity.this,
                                    session,
                                    response,
                                    tvError
                            );
                        }
                    }

                    @Override
                    public void onFailure(
                            @NonNull Call<Models.TransferResponse> call,
                            @NonNull Throwable t) {

                        setLoading(false);

                        UiUtil.showError(
                                tvError,
                                "Could not confirm the result. Check your account "
                                        + "balance and transaction history before trying again."
                        );
                    }
                });
    }

    private void setLoading(boolean loading) {

        btnTransfer.setEnabled(!loading);

        progress.setVisibility(
                loading ? View.VISIBLE : View.GONE
        );
    }
}
