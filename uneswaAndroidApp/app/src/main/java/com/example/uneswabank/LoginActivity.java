
package com.example.uneswabank;

import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ProgressBar;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.android.material.button.MaterialButton;
import com.google.android.material.textfield.TextInputEditText;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LoginActivity extends AppCompatActivity {

    // UI components
    private TextInputEditText identifierInput;
    private TextInputEditText passwordInput;

    private MaterialButton loginButton;

    private ProgressBar progressBar;
    private TextView errorText;

    // API and session
    private ApiService apiService;
    private SessionManager sessionManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_login);

        // Initialize UI components
        identifierInput = findViewById(R.id.etIdentifier);
        passwordInput = findViewById(R.id.etPassword);

        loginButton = findViewById(R.id.btnLogin);

        progressBar = findViewById(R.id.progressBar);
        errorText = findViewById(R.id.tvError);

        // Initialize API and session manager
        apiService = ApiClient.getApiService();
        sessionManager = new SessionManager(this);

        // Hide previous errors and loading indicator
        errorText.setVisibility(View.GONE);
        progressBar.setVisibility(View.GONE);

        // Login button click
        loginButton.setOnClickListener(v -> performLogin());

        // Check existing session
        String savedToken = sessionManager.getToken();

        if (savedToken != null && !savedToken.trim().isEmpty()) {
            openHomeActivity();
        }
    }

    private void performLogin() {

        // Get identifier
        String identifier = identifierInput.getText() != null
                ? identifierInput.getText().toString().trim()
                : "";

        // Get password
        String password = passwordInput.getText() != null
                ? passwordInput.getText().toString()
                : "";

        // Validate identifier
        if (identifier.isEmpty()) {
            identifierInput.setError(
                    "Enter your email, phone or account number"
            );
            identifierInput.requestFocus();
            return;
        }

        // Validate password
        if (password.isEmpty()) {
            passwordInput.setError("Enter your password");
            passwordInput.requestFocus();
            return;
        }

        // Clear previous errors
        errorText.setVisibility(View.GONE);
        identifierInput.setError(null);
        passwordInput.setError(null);

        // Show loading indicator
        setLoading(true);

        // Create login request
        Models.LoginRequest loginRequest =
                new Models.LoginRequest(identifier, password);

        // Send request to Node.js backend
        apiService.login(loginRequest).enqueue(
                new Callback<Models.LoginResponse>() {

                    @Override
                    public void onResponse(
                            Call<Models.LoginResponse> call,
                            Response<Models.LoginResponse> response) {

                        setLoading(false);

                        if (response.isSuccessful()
                                && response.body() != null) {

                            Models.LoginResponse result = response.body();

                            if (result.success
                                    && result.token != null
                                    && !result.token.isEmpty()
                                    && result.customer != null) {

                                // Save JWT and customer information
                                sessionManager.save(
                                        result.token,
                                        result.customer
                                );

                                // Open banking dashboard
                                openHomeActivity();

                            } else {

                                showError(
                                        result.message != null
                                                ? result.message
                                                : "Login failed. Please try again."
                                );
                            }

                        } else {

                            // Handle backend error responses
                            String message;

                            if (response.code() == 401) {
                                message = "Invalid account details or password.";
                            } else if (response.code() == 403) {
                                message = "Your account is not active. Contact the bank.";
                            } else {
                                message = "Login failed. Please try again.";
                            }

                            showError(message);
                        }
                    }

                    @Override
                    public void onFailure(
                            Call<Models.LoginResponse> call,
                            Throwable t) {

                        setLoading(false);

                        showError(
                                "Cannot connect to banking server. "
                                        + "Please check your connection and try again."
                        );
                    }
                }
        );
    }

    // Control loading indicator and login button
    private void setLoading(boolean loading) {

        progressBar.setVisibility(
                loading ? View.VISIBLE : View.GONE
        );

        loginButton.setEnabled(!loading);

        loginButton.setText(
                loading ? "Please wait..." : "Login"
        );
    }

    // Display login errors
    private void showError(String message) {

        errorText.setText(message);
        errorText.setVisibility(View.VISIBLE);
    }

    // Open banking home screen
    private void openHomeActivity() {

        Intent intent = new Intent(
                LoginActivity.this,
                HomeActivity.class
        );

        startActivity(intent);
        finish();
    }
}
