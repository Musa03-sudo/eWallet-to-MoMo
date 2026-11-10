
package com.example.uneswabank;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.Intent;

import java.util.Locale;

/**
 * Manages the customer's login session.
 * Stores JWT and basic account information.
 */
public class SessionManager {

    private final SharedPreferences prefs;

    public SessionManager(Context context) {
        prefs = context.getSharedPreferences(
                "uneswa_session",
                Context.MODE_PRIVATE
        );
    }

    // Save JWT and customer information
    public void save(String token, Models.Account a) {

        prefs.edit()
                .putString("token", token)
                .putString("account_number", a.accountNumber)
                .putString("full_name", a.fullName)
                .putString("email", a.email)
                .putString("cellphone", a.cellphone)
                .putString("balance", String.valueOf(a.balance))
                .putString("currency", a.currency)
                .apply();
    }

    // Retrieve JWT
    public String getToken() {
        return prefs.getString("token", null);
    }

    // Authorization header for protected API requests
    public String getAuthHeader() {

        String token = getToken();

        if (token == null || token.trim().isEmpty()) {
            return null;
        }

        return "Bearer " + token;
    }
    public void expire(Context context) {

        clear();

        Intent intent = new Intent(
                context,
                LoginActivity.class
        );

        intent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                        Intent.FLAG_ACTIVITY_CLEAR_TASK
        );

        context.startActivity(intent);
    }

    // Retrieve account details
    public String getAccountNumber() {
        return prefs.getString("account_number", "");
    }
    public void setBalance(double balance) {
        prefs.edit()
                .putString("balance", String.valueOf(balance))
                .apply();
    }

    public String getFullName() {
        return prefs.getString("full_name", "");
    }

    public String getEmail() {
        return prefs.getString("email", "");
    }

    public String getCellphone() {
        return prefs.getString("cellphone", "");
    }

    public String getCurrency() {
        return prefs.getString("currency", "SZL");
    }

    // Retrieve balance
    public double getBalance() {

        String balanceText = prefs.getString("balance", "0");

        try {
            return Double.parseDouble(balanceText);
        } catch (NumberFormatException e) {
            return 0.0;
        }
    }

    // Format balance for dashboard display
    public String getBalanceText() {

        return String.format(
                Locale.US,
                "%s %.2f",
                getCurrency(),
                getBalance()
        );
    }

    // Check whether customer is logged in
    public boolean isLoggedIn() {

        String token = getToken();

        return token != null && !token.trim().isEmpty();
    }

    // Clear session during logout
    public void clear() {
        prefs.edit().clear().apply();
    }
}
