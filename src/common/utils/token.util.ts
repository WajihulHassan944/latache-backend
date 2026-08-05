export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization) return null;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (extra || scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
};
