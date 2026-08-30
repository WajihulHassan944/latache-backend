import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

interface JwtHeader {
  alg?: unknown;
  kid?: unknown;
}

export type OidcJwtPayload = Record<string, unknown>;

interface CachedJwks {
  keys: Array<JsonWebKey & { kid?: string; alg?: string; use?: string }>;
  expiresAt: number;
}

@Injectable()
export class OidcJwtVerifierService {
  private readonly cache = new Map<string, CachedJwks>();

  async verifyRs256(input: {
    token: string;
    jwksUrl: string;
    issuers: readonly string[];
    audiences: readonly string[];
    nonce?: string;
    fallbackCacheSeconds?: number;
    clockSkewSeconds?: number;
  }): Promise<OidcJwtPayload> {
    const parts = input.token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Invalid social identity token');

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = this.decodeJson<JwtHeader>(encodedHeader!);
    const payload = this.decodeJson<OidcJwtPayload>(encodedPayload!);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) {
      throw new UnauthorizedException('Invalid social identity token');
    }

    const key = await this.resolveKey(
      input.jwksUrl,
      header.kid,
      input.fallbackCacheSeconds ?? 3600,
    );
    if ((key.alg && key.alg !== 'RS256') || (key.use && key.use !== 'sig')) {
      throw new UnauthorizedException('Invalid social identity signing key');
    }
    const publicKey = createPublicKey({ key, format: 'jwk' });
    const signed = Buffer.from(`${encodedHeader}.${encodedPayload}`, 'utf8');
    const signature = Buffer.from(encodedSignature!, 'base64url');
    if (!verify('RSA-SHA256', signed, publicKey, signature)) {
      throw new UnauthorizedException('Invalid social identity token');
    }

    const skew = input.clockSkewSeconds ?? 60;
    const now = Math.floor(Date.now() / 1000);
    const issuer = this.stringClaim(payload, 'iss');
    if (!issuer || !input.issuers.includes(issuer)) {
      throw new UnauthorizedException('Invalid social identity token issuer');
    }
    if (!this.audienceMatches(payload.aud, input.audiences)) {
      throw new UnauthorizedException('Invalid social identity token audience');
    }
    if (Array.isArray(payload.aud) && payload.aud.length > 1) {
      const authorizedParty = this.stringClaim(payload, 'azp');
      if (!authorizedParty || !input.audiences.includes(authorizedParty)) {
        throw new UnauthorizedException('Invalid social identity token authorized party');
      }
    }
    const exp = this.numberClaim(payload, 'exp');
    if (!exp || exp < now - skew) {
      throw new UnauthorizedException('Social identity token has expired');
    }
    const iat = this.numberClaim(payload, 'iat');
    if (iat && iat > now + skew) {
      throw new UnauthorizedException('Invalid social identity token issue time');
    }
    const nbf = this.numberClaim(payload, 'nbf');
    if (nbf && nbf > now + skew) {
      throw new UnauthorizedException('Social identity token is not active yet');
    }
    if (input.nonce !== undefined && payload.nonce !== input.nonce) {
      throw new UnauthorizedException('Social identity token nonce does not match');
    }
    return payload;
  }

  private async resolveKey(
    jwksUrl: string,
    kid: string,
    fallbackCacheSeconds: number,
  ): Promise<JsonWebKey & { kid?: string; alg?: string; use?: string }> {
    const cached = this.cache.get(jwksUrl);
    if (cached && cached.expiresAt > Date.now()) {
      const key = cached.keys.find((item) => item.kid === kid);
      if (key) return key;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(jwksUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (!response.ok) throw new Error(`JWKS request failed with ${response.status}`);
      const body: unknown = await response.json();
      const keys = this.parseKeys(body);
      const maxAge = this.cacheMaxAge(response.headers.get('cache-control')) ?? fallbackCacheSeconds;
      this.cache.set(jwksUrl, { keys, expiresAt: Date.now() + maxAge * 1000 });
      const key = keys.find((item) => item.kid === kid);
      if (!key) throw new UnauthorizedException('Social identity signing key is unavailable');
      return key;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Unable to verify social identity token');
    }
  }

  private parseKeys(body: unknown): Array<JsonWebKey & { kid?: string; alg?: string; use?: string }> {
    if (!this.isRecord(body) || !Array.isArray(body.keys)) {
      throw new Error('Invalid JWKS response');
    }
    return body.keys.filter((item) => this.isRecord(item)) as Array<
      JsonWebKey & { kid?: string; alg?: string; use?: string }
    >;
  }

  private decodeJson<T>(segment: string): T {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
      if (!this.isRecord(parsed)) throw new Error('JWT segment is not an object');
      return parsed as T;
    } catch {
      throw new UnauthorizedException('Invalid social identity token');
    }
  }

  private audienceMatches(value: unknown, allowed: readonly string[]): boolean {
    if (typeof value === 'string') return allowed.includes(value);
    if (Array.isArray(value)) return value.some((item) => typeof item === 'string' && allowed.includes(item));
    return false;
  }

  private stringClaim(payload: OidcJwtPayload, key: string): string | null {
    return typeof payload[key] === 'string' ? payload[key] as string : null;
  }

  private numberClaim(payload: OidcJwtPayload, key: string): number | null {
    return typeof payload[key] === 'number' && Number.isFinite(payload[key]) ? payload[key] as number : null;
  }

  private cacheMaxAge(value: string | null): number | null {
    const match = value?.match(/(?:^|,)\s*max-age=(\d+)/i);
    return match ? Number(match[1]) : null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
