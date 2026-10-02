import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterCustomerDto } from './register-customer.dto';

const base = {
  firstName: 'Sarah',
  lastName: 'Ahmed',
  email: 'sarah@example.com',
  password: 'StrongPassword@123',
  zipCode: '10001',
  acceptedTermsAndPrivacyPolicy: true,
};

describe('RegisterCustomerDto phone/country-code consistency', () => {
  it('accepts a phone number that matches its country code', async () => {
    const dto = plainToInstance(RegisterCustomerDto, {
      ...base,
      phoneCountryCode: '+212',
      phoneNumber: '612345678',
    });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a phone number shaped for a different country than its code', async () => {
    const dto = plainToInstance(RegisterCustomerDto, {
      ...base,
      phoneCountryCode: '+212', // Morocco
      phoneNumber: '3001234567', // Pakistani-shaped mobile number
    });
    const errors = await validate(dto);
    const phoneError = errors.find((error) => error.property === 'phoneNumber');
    expect(phoneError?.constraints).toHaveProperty('isPhoneMatchingCountryCode');
  });
});
