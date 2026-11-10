package com.example.uneswabank;

import android.app.Activity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.TextView;


import com.google.android.material.textfield.TextInputEditText;

import java.util.Locale;

import retrofit2.Response;

/** Small helpers shared by the screens. */
public class UiUtil {

    /** Fills the blue header bar (view_header.xml) and wires the back arrow. */
    public static void setupHeader(Activity activity, String title) {
        ((TextView) activity.findViewById(R.id.tvTitle)).setText(title);
        activity.findViewById(R.id.btnBack).setOnClickListener(v -> activity.finish());
    }

    public static String money(String currency, double value) {
        return String.format(Locale.US, "%s %.2f", currency, value);
    }

    public static String textOf(TextInputEditText field) {
        return field.getText() == null ? "" : field.getText().toString().trim();
    }

    public static void showError(TextView target, String message) {
        target.setText(message);
        target.setVisibility(View.VISIBLE);
    }

    /** A 401 means the 30-minute token expired: go back to login. Otherwise show the API's message. */
    public static void showApiError(Activity activity, SessionManager session,
                                    Response<?> response, TextView target) {
        if (response.code() == 401) {
            session.expire(activity);
            return;
        }
        showError(target, ApiClient.parseError(response));
    }

    public static void hideKeyboard(Activity activity) {
        View view = activity.getCurrentFocus();
        if (view != null) {
            InputMethodManager imm =
                    (InputMethodManager) activity.getSystemService(Activity.INPUT_METHOD_SERVICE);
            imm.hideSoftInputFromWindow(view.getWindowToken(), 0);
        }
    }
}