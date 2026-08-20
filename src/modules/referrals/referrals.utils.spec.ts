import { calculateReferralDiscount } from './referrals.utils';

describe('calculateReferralDiscount', () => {
  it('calculates the configured service percentage', () => {
    expect(
      calculateReferralDiscount({
        serviceAmount: 100,
        totalBeforeDiscount: 120,
        percent: 10,
        maximumDiscountAmount: 0,
        minimumCustomerChargeAmount: 5,
        minimumQualifyingBookingAmount: 25,
      }),
    ).toBe(10);
  });

  it('honors an explicit monetary cap', () => {
    expect(
      calculateReferralDiscount({
        serviceAmount: 500,
        totalBeforeDiscount: 550,
        percent: 20,
        maximumDiscountAmount: 40,
        minimumCustomerChargeAmount: 5,
        minimumQualifyingBookingAmount: 25,
      }),
    ).toBe(40);
  });

  it('never discounts below the stricter real-charge/qualification floor', () => {
    expect(
      calculateReferralDiscount({
        serviceAmount: 100,
        totalBeforeDiscount: 60,
        percent: 50,
        maximumDiscountAmount: 0,
        minimumCustomerChargeAmount: 5,
        minimumQualifyingBookingAmount: 25,
      }),
    ).toBe(35);
  });

  it('returns zero when the undiscounted total cannot satisfy the floor', () => {
    expect(
      calculateReferralDiscount({
        serviceAmount: 20,
        totalBeforeDiscount: 20,
        percent: 50,
        maximumDiscountAmount: 0,
        minimumCustomerChargeAmount: 25,
        minimumQualifyingBookingAmount: 25,
      }),
    ).toBe(0);
  });
});
