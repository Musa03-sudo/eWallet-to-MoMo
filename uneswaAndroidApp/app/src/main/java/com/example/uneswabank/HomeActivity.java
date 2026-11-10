
package com.example.uneswabank;

import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

public class HomeActivity extends AppCompatActivity {

    private SessionManager session;

    private TextView tvWelcome;
    private TextView tvBalance;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_home);

        // Initialize session manager
        session = new SessionManager(this);

        // Check whether customer is logged in
        if (!session.isLoggedIn()) {
            redirectToLogin();
            return;
        }

        // Initialize UI components
        tvWelcome = findViewById(R.id.tvWelcome);
        tvBalance = findViewById(R.id.tvBalance);

        // Display customer information
        tvWelcome.setText(
                "Welcome, " + session.getFullName()
        );

        displayBalance();

        // Payment tile
        findViewById(R.id.tilePayment).setOnClickListener(v -> {
            startActivity(
                    new Intent(
                            HomeActivity.this,
                            PaymentActivity.class
                    )
            );
        });

        // Account tile
        findViewById(R.id.tileAccount).setOnClickListener(v -> {
            startActivity(
                    new Intent(
                            HomeActivity.this,
                            AccountActivity.class
                    )
            );
        });

        // Logout tile
        findViewById(R.id.tileLogout).setOnClickListener(v -> logout());
    }

    @Override
    protected void onResume() {
        super.onResume();

        if (session != null && session.isLoggedIn()
                && tvBalance != null) {

            displayBalance();
        }
    }

    // Display customer's available balance
    private void displayBalance() {

        tvBalance.setText(
                "Balance: " + session.getBalanceText()
        );
    }

    // Logout customer
    private void logout() {

        // Clear saved JWT and customer information
        session.clear();

        // Return to login screen
        redirectToLogin();
    }

    // Redirect to login screen
    private void redirectToLogin() {

        Intent intent = new Intent(
                HomeActivity.this,
                LoginActivity.class
        );

        // Prevent returning to dashboard using Back button
        intent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                        Intent.FLAG_ACTIVITY_CLEAR_TASK
        );

        startActivity(intent);
        finish();
    }
}
