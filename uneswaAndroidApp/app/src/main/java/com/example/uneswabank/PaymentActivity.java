
package com.example.uneswabank;

import android.content.Intent;
import android.os.Bundle;

import androidx.appcompat.app.AppCompatActivity;

/**
 * Payment menu: E-Wallet or Bank Transfer.
 */
public class PaymentActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_payment);

        // Configure screen header
        UiUtil.setupHeader(this, "Payment");

        // E-Wallet payment
        findViewById(R.id.tileEwallet).setOnClickListener(v -> {

            Intent intent = new Intent(
                    PaymentActivity.this,
                    EwalletActivity.class
            );

            startActivity(intent);
        });

        // Bank transfer
        findViewById(R.id.tileTransfer).setOnClickListener(v -> {

            Intent intent = new Intent(
                    PaymentActivity.this,
                    TransferActivity.class
            );

            startActivity(intent);
        });
    }
}
