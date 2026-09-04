import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { loginRequestExamples, loginResponseExamples } from './swagger/login.examples';

const canonicalRoutes = [
  ['registerCustomer', RequestMethod.POST, 'customers/register'],
  ['registerTasker', RequestMethod.POST, 'taskers/register'],
  ['createAdmin', RequestMethod.POST, 'admins/register'],
  ['login', RequestMethod.POST, 'login'],
  ['refresh', RequestMethod.POST, 'refresh'],
  ['verifyEmail', RequestMethod.POST, 'verify-email'],
  ['resendVerification', RequestMethod.POST, 'resend-verification-email'],
  ['forgotPassword', RequestMethod.POST, 'forgot-password'],
  ['verifyResetOtp', RequestMethod.POST, 'verify-reset-otp'],
  ['resetPassword', RequestMethod.POST, 'reset-password'],
  ['changePassword', RequestMethod.PATCH, 'change-password'],
  ['me', RequestMethod.GET, 'me'],
  ['updateMe', RequestMethod.PATCH, 'me'],
  ['updateMyLocation', RequestMethod.PATCH, 'me/location'],
  ['listSessions', RequestMethod.GET, 'sessions'],
  ['revokeSession', RequestMethod.DELETE, 'sessions/:id'],
  ['logout', RequestMethod.POST, 'logout'],
  ['logoutAll', RequestMethod.POST, 'sessions/logout-all'],
] as const;

const removedLegacyPaths = [
  'sign-up',
  'refresh-token',
  'verify-otp',
  'resend-otp',
  'verify-pass-token',
  'verify-forgot-password',
  'get-loggedin-user',
  'verify-token',
  'logout-all',
];

describe('Auth Swagger and route surface', () => {
  it('uses the auth controller prefix', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AuthController)).toBe('auth');
  });

  it.each(canonicalRoutes)('exposes %s', (methodName, method, path) => {
    const handler = AuthController.prototype[methodName];
    expect(handler).toBeDefined();
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(method);
  });

  it('documents request and response examples for every account role', () => {
    expect(Object.keys(loginRequestExamples)).toEqual([
      'customer',
      'tasker',
      'admin',
      'superAdmin',
    ]);
    expect(Object.keys(loginResponseExamples)).toEqual([
      'customer',
      'tasker',
      'admin',
      'superAdmin',
    ]);
  });

  it('publishes the seeded super-admin login as literal JSON values', () => {
    expect(loginRequestExamples.superAdmin.value).toEqual({
      email: 'latache.superadmin@yopmail.com',
      password: 'Admin@12345',
      expectedRole: 'super_admin',
      device: 'Super-admin dashboard',
    });
  });

  it('does not expose any removed legacy path', () => {
    const paths = Object.getOwnPropertyNames(AuthController.prototype)
      .filter((name) => name !== 'constructor')
      .map((name) =>
        Reflect.getMetadata(
          PATH_METADATA,
          AuthController.prototype[name as keyof AuthController] as object,
        ),
      )
      .filter((value): value is string => typeof value === 'string');

    expect(paths).not.toEqual(expect.arrayContaining(removedLegacyPaths));
  });
});
