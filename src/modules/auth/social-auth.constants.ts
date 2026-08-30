export const SOCIAL_AUTH_PROVIDER = {
  Google: 'google',
  Apple: 'apple',
} as const;

export type SocialAuthProvider =
  (typeof SOCIAL_AUTH_PROVIDER)[keyof typeof SOCIAL_AUTH_PROVIDER];

export const SOCIAL_AUTH_PROVIDERS: readonly SocialAuthProvider[] = [
  SOCIAL_AUTH_PROVIDER.Google,
  SOCIAL_AUTH_PROVIDER.Apple,
];
