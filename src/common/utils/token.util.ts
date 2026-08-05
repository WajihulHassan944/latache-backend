import type { Request } from 'express';

export const extractBearerToken = (authorization?: string): string | null => {
  if (!authorization) return null;
  const [scheme, token, extra] = authorization.trim().split(/\s+/);
  if (extra || scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
};

export const extractAccessToken = (
  request: Request,
  allowQueryCompatibility: boolean,
): string | null => {
  const headerToken = extractBearerToken(request.headers.authorization);
  if (headerToken) return headerToken;
  if (!allowQueryCompatibility) return null;
  const queryToken = request.query.webToken;
  return typeof queryToken === 'string' && queryToken.length > 0 ? queryToken : null;
};
