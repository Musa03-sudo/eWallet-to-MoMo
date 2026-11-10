import apiClient from "./apiClient";

export const getMyVouchers = async () => {
  const response = await apiClient.get("/ewallet/vouchers");
  return response.data;
};

export const getVoucherDetails = async (voucherCode) => {
  const response = await apiClient.get(
    `/ewallet/vouchers/${encodeURIComponent(voucherCode)}`
  );

  return response.data;
};

export const reviewTransfer = async (transferDetails) => {
  const response = await apiClient.post(
    "/ewallet/transfer/review",
    transferDetails
  );

  return response.data;
};