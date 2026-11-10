package com.example.uneswabank;

import retrofit2.Retrofit;
import retrofit2.converter.gson.GsonConverterFactory;
import retrofit2.Response;
import okhttp3.ResponseBody;
import java.io.IOException;

public class ApiClient {

    private static final String BASE_URL = "http://10.184.223.95:5000/";

    private static Retrofit retrofit = null;
    private static ApiService apiService = null;

    public static Retrofit getClient() {

        if (retrofit == null) {

            retrofit = new Retrofit.Builder()
                    .baseUrl(BASE_URL)
                    .addConverterFactory(GsonConverterFactory.create())
                    .build();
        }

        return retrofit;
    }

    public static ApiService getApiService() {

        if (apiService == null) {
            apiService = getClient().create(ApiService.class);
        }

        return apiService;
    }

    public static String parseError(Response<?> response) {

        if (response == null) {
            return "An unexpected error occurred.";
        }

        ResponseBody errorBody = response.errorBody();

        if (errorBody != null) {
            try {
                String errorMessage = errorBody.string();

                if (errorMessage != null && !errorMessage.trim().isEmpty()) {
                    return errorMessage;
                }

            } catch (IOException e) {
                e.printStackTrace();
            }
        }

        return "Request failed. HTTP error: " + response.code();
    }
}