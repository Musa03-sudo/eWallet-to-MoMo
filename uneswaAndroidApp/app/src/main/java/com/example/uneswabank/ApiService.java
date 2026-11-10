
package com.example.uneswabank;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.Header;
import retrofit2.http.POST;

public interface ApiService {

    // Customer login
    @POST("api/auth/login")
    Call<Models.LoginResponse> login(
            @Body Models.LoginRequest body
    );

    // Retrieve logged-in customer's account details
    @GET("api/account")
    Call<Models.AccountResponse> getAccount(
            @Header("Authorization") String auth
    );

    // Review eWallet transaction before confirmation
    @POST("api/ewallet/review")
    Call<Models.ReviewResponse> ewalletReview(
            @Header("Authorization") String auth,
            @Body Models.EwalletRequest body
    );

    // Confirm eWallet transaction and generate voucher
    @POST("api/ewallet/send")
    Call<Models.SendResponse> ewalletSend(
            @Header("Authorization") String auth,
            @Body Models.EwalletRequest request
    );
    @POST("api/transfer")
    Call<Models.TransferResponse> transfer(
            @Header("Authorization") String auth,
            @Body Models.TransferRequest request
    );
    // Check whether recipient is registered
    @POST("api/ewallet/recipient/check")
    Call<Models.RecipientCheckResponse> checkEwalletRecipient(
            @Header("Authorization") String auth,
            @Body Models.RecipientCheckRequest request
    );
}
