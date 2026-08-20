const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateReferralDiscount = (input: {
  serviceAmount: number;
  totalBeforeDiscount: number;
  percent: number;
  maximumDiscountAmount: number;
  minimumCustomerChargeAmount: number;
  minimumQualifyingBookingAmount: number;
}): number => {
  if (input.percent <= 0 || input.serviceAmount <= 0 || input.totalBeforeDiscount <= 0) return 0;
  const percentageAmount = roundMoney((input.serviceAmount * input.percent) / 100);
  const chargeFloor = Math.max(
    input.minimumCustomerChargeAmount,
    input.minimumQualifyingBookingAmount,
  );
  const paymentCap = Math.max(0, roundMoney(input.totalBeforeDiscount - chargeFloor));
  const configuredCap =
    input.maximumDiscountAmount > 0 ? input.maximumDiscountAmount : percentageAmount;
  return Math.max(0, roundMoney(Math.min(percentageAmount, configuredCap, paymentCap)));
};
