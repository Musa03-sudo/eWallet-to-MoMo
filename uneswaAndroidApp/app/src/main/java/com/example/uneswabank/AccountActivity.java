
package com.example.uneswabank;

import android.os.Bundle;
import android.view.View;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Displays the logged-in customer's account details.
 */
public class AccountActivity extends AppCompatActivity {

    private SessionManager session;

    private TextView tvName;
    private TextView tvAccNo;
    private TextView tvEmail;
    private TextView tvCell;
    private TextView tvBalance;
    private TextView tvStatus;
    private TextView tvError;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_account);

        UiUtil.setupHeader(this, "Account");

        session = new SessionManager(this);

        // Check whether the customer is logged in.
        if (!session.isLoggedIn()) {
            finish();
            return;
        }

        // Initialize UI components.
        tvName = findViewById(R.id.tvName);
        tvAccNo = findViewById(R.id.tvAccNo);
        tvEmail = findViewById(R.id.tvEmail);
        tvCell = findViewById(R.id.tvCell);
        tvBalance = findViewById(R.id.tvBalance);
        tvStatus = findViewById(R.id.tvStatus);
        tvError = findViewById(R.id.tvError);

        // Display locally saved account information first.
        displaySavedAccountDetails();
    }

    @Override
    protected void onResume() {
        super.onResume();

        if (session != null && session.isLoggedIn()) {
            loadAccountDetails();
        }
    }

    /**
     * Displays account information saved during login.
     */
    private void displaySavedAccountDetails() {

        tvName.setText(session.getFullName());
        tvAccNo.setText(session.getAccountNumber());
        tvEmail.setText(session.getEmail());
        tvCell.setText(session.getCellphone());
        tvBalance.setText(session.getBalanceText());

        tvStatus.setText("Active");
        tvError.setVisibility(View.GONE);
    }

    /**
     * Retrieves the latest account information from the backend.
     */
    private void loadAccountDetails() {

        tvError.setVisibility(View.GONE);

        ApiClient.getApiService()
                .getAccount(session.getAuthHeader())
                .enqueue(new Callback<Models.AccountResponse>() {

                    @Override
                    public void onResponse(
                            Call<Models.AccountResponse> call,
                            Response<Models.AccountResponse> response) {

                        if (response.isSuccessful()
                                && response.body() != null
                                && response.body().account != null) {

                            // Extract the actual account from AccountResponse.
                            Models.Account account = response.body().account;

                            tvName.setText(account.fullName);
                            tvAccNo.setText(account.accountNumber);
                            tvEmail.setText(account.email);
                            tvCell.setText(account.cellphone);

                            tvBalance.setText(
                                    UiUtil.money(
                                            account.currency,
                                            account.balance
                                    )
                            );

                            if (account.status != null) {
                                tvStatus.setText(account.status);
                            }

                        } else if (response.code() == 401) {

                            // Session expired or token is invalid.
                            session.clear();

                            android.widget.Toast.makeText(
                                    AccountActivity.this,
                                    "Your session has expired. Please log in again.",
                                    android.widget.Toast.LENGTH_LONG
                            ).show();

                            finish();

                        } else {

                            tvError.setText(
                                    "Unable to refresh account information. "
                                            + "Showing saved information."
                            );

                            tvError.setVisibility(View.VISIBLE);
                        }
                    }

                    @Override
                    public void onFailure(
                            Call<Models.AccountResponse> call,
                            Throwable t) {

                        tvError.setText(
                                "Cannot reach the banking server. "
                                        + "Showing saved account information."
                        );

                        tvError.setVisibility(View.VISIBLE);
                    }
                });
    }
}
