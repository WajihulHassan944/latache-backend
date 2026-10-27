import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { AppCacheService, CacheNamespace } from '../../../infrastructure/redis/app-cache.service';
import type { User } from '../../../generated/prisma/client';

const SETTING_KEY = 'google_search_console';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes - plenty for an admin to complete the Google consent screen.
const SUMMARY_CACHE_TTL_SECONDS = 3600; // Search Console data itself lags ~2 days; an hourly cache is more than fresh enough.
const SUMMARY_ROW_LIMIT = 25;

interface StoredConnection {
  connected: boolean;
  propertyUrl: string | null;
  connectedAt: string | null;
  encryptedRefreshToken: string | null;
}

export interface TopQueryRow {
  query: string;
  impressions: number;
  clicks: number;
  ctr: number;
  position: number;
}

export interface SearchConsoleSummary {
  impressions: number;
  clicks: number;
  avgCtr: number;
  avgPosition: number;
  topQueries: TopQueryRow[];
}

const EMPTY_CONNECTION: StoredConnection = {
  connected: false,
  propertyUrl: null,
  connectedAt: null,
  encryptedRefreshToken: null,
};

@Injectable()
export class SearchConsoleService {
  private readonly logger = new Logger(SearchConsoleService.name);
  // Access tokens are short-lived (~1hr) and deliberately never persisted - just held
  // in-memory for the life of this process, re-minted from the stored refresh token.
  private accessToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: AppCacheService,
    private readonly audit: AdminAuditService,
  ) {}

  async status() {
    const connection = await this.connectionRow();
    return { connected: connection.connected, propertyUrl: connection.propertyUrl, connectedAt: connection.connectedAt };
  }

  connect(): { authUrl: string } {
    const { clientId, redirectUri } = this.requireOAuthConfig();
    const state = this.signState();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return { authUrl: `${AUTH_ENDPOINT}?${params.toString()}` };
  }

  /** Hit directly by Google in the admin's browser - no bearer token, so the `state` HMAC is the only gate. Never throws; always resolves to a redirect target. */
  async handleCallback(code: string | undefined, state: string | undefined): Promise<string> {
    const frontendBase = (this.config.get<string>('frontend.baseUrl') ?? 'http://localhost:3000').replace(/\/$/, '');
    const success = `${frontendBase}/admin/seo-management?tab=market-research&search_console=success`;
    const failure = `${frontendBase}/admin/seo-management?tab=market-research&search_console=error`;
    try {
      if (!code || !state || !this.verifyState(state)) return failure;
      const { clientId, clientSecret, redirectUri, siteUrl } = this.requireOAuthConfig();
      const response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        this.logger.error(`Search Console token exchange failed: ${response.status} ${detail.slice(0, 500)}`);
        return failure;
      }
      const payload = (await response.json()) as { refresh_token?: string; access_token?: string; expires_in?: number };
      if (!payload.refresh_token) {
        this.logger.error('Search Console token exchange did not return a refresh_token (prompt=consent should always issue one)');
        return failure;
      }
      await this.prisma.platformSetting.upsert({
        where: { key: SETTING_KEY },
        create: {
          key: SETTING_KEY,
          value: {
            connected: true,
            propertyUrl: siteUrl,
            connectedAt: new Date().toISOString(),
            encryptedRefreshToken: this.encrypt(payload.refresh_token),
          },
        },
        update: {
          value: {
            connected: true,
            propertyUrl: siteUrl,
            connectedAt: new Date().toISOString(),
            encryptedRefreshToken: this.encrypt(payload.refresh_token),
          },
        },
      });
      this.accessToken = payload.access_token && payload.expires_in
        ? { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 }
        : null;
      await this.audit.record({ action: 'seo_search_console_connected', entityType: 'seo_search_console', entityId: 'global', metadata: { propertyUrl: siteUrl } });
      return success;
    } catch (error) {
      this.logger.error(`Search Console callback failed: ${error instanceof Error ? error.message : String(error)}`);
      return failure;
    }
  }

  async disconnect(actor: User) {
    await this.prisma.platformSetting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: { ...EMPTY_CONNECTION } },
      update: { value: { ...EMPTY_CONNECTION } },
    });
    this.accessToken = null;
    await this.audit.record({ actorId: actor.id, action: 'seo_search_console_disconnected', entityType: 'seo_search_console', entityId: 'global' });
    return { connected: false };
  }

  async summary(query: { startDate?: string; endDate?: string }): Promise<SearchConsoleSummary> {
    const { startDate, endDate } = this.resolveRange(query);
    return this.cache.getOrLoad(CacheNamespace.AdminAnalytics, { operation: 'seo-search-console-summary', startDate, endDate }, SUMMARY_CACHE_TTL_SECONDS, () => this.fetchSummary(startDate, endDate));
  }

  private async fetchSummary(startDate: string, endDate: string): Promise<SearchConsoleSummary> {
    const { siteUrl } = this.requireOAuthConfig();
    const accessToken = await this.accessTokenOrThrow();
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

    const [totals, queries] = await Promise.all([
      this.queryAnalytics(endpoint, accessToken, { startDate, endDate }),
      this.queryAnalytics(endpoint, accessToken, { startDate, endDate, dimensions: ['query'], rowLimit: SUMMARY_ROW_LIMIT }),
    ]);

    const totalsRow = (totals.rows as Array<{ clicks: number; impressions: number; ctr: number; position: number }> | undefined)?.[0];
    const queryRows = (queries.rows as Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }> | undefined) ?? [];

    return {
      impressions: totalsRow?.impressions ?? 0,
      clicks: totalsRow?.clicks ?? 0,
      avgCtr: totalsRow?.ctr ?? 0,
      avgPosition: totalsRow?.position ?? 0,
      topQueries: queryRows.map((row) => ({
        query: row.keys?.[0] ?? '',
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: row.ctr,
        position: row.position,
      })),
    };
  }

  private async queryAnalytics(endpoint: string, accessToken: string, body: Record<string, unknown>): Promise<{ rows?: unknown[] }> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`SEARCH_CONSOLE_QUERY_FAILED_${response.status}:${detail.slice(0, 500)}`);
    }
    return (await response.json()) as { rows?: unknown[] };
  }

  private async accessTokenOrThrow(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 5_000) return this.accessToken.token;
    const connection = await this.connectionRow();
    if (!connection.connected || !connection.encryptedRefreshToken) {
      throw new ServiceUnavailableException({
        code: 'SEARCH_CONSOLE_NOT_CONNECTED',
        message: 'Google Search Console is not connected. Connect it from the SEO Management panel first.',
      });
    }
    const { clientId, clientSecret } = this.requireOAuthConfig();
    const refreshToken = this.decrypt(connection.encryptedRefreshToken);
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new ServiceUnavailableException({
        code: 'SEARCH_CONSOLE_TOKEN_REFRESH_FAILED',
        message: `Failed to refresh Google Search Console access token: ${response.status} ${detail.slice(0, 300)}`,
      });
    }
    const payload = (await response.json()) as { access_token: string; expires_in: number };
    this.accessToken = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
    return this.accessToken.token;
  }

  private resolveRange(query: { startDate?: string; endDate?: string }): { startDate: string; endDate: string } {
    if (query.startDate && query.endDate) return { startDate: query.startDate, endDate: query.endDate };
    const end = new Date();
    const start = new Date(end.getTime() - 28 * 24 * 60 * 60 * 1000);
    const toDateString = (d: Date) => d.toISOString().slice(0, 10);
    return { startDate: toDateString(start), endDate: toDateString(end) };
  }

  private async connectionRow(): Promise<StoredConnection> {
    const row = await this.prisma.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return { ...EMPTY_CONNECTION };
    const value = row.value as unknown as Partial<StoredConnection>;
    return {
      connected: Boolean(value.connected),
      propertyUrl: value.propertyUrl ?? null,
      connectedAt: value.connectedAt ?? null,
      encryptedRefreshToken: value.encryptedRefreshToken ?? null,
    };
  }

  private requireOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string; siteUrl: string } {
    const clientId = this.config.get<string>('googleSearchConsole.clientId');
    const clientSecret = this.config.get<string>('googleSearchConsole.clientSecret');
    const redirectUri = this.config.get<string>('googleSearchConsole.redirectUri');
    const siteUrl = this.config.get<string>('googleSearchConsole.siteUrl');
    if (!clientId || !clientSecret || !redirectUri || !siteUrl) {
      throw new ServiceUnavailableException({
        code: 'SEARCH_CONSOLE_NOT_CONFIGURED',
        message: 'Google Search Console integration is disabled until GOOGLE_SEARCH_CONSOLE_CLIENT_ID, GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET and GOOGLE_SEARCH_CONSOLE_SITE_URL are configured.',
      });
    }
    return { clientId, clientSecret, redirectUri, siteUrl };
  }

  /** Signed, short-lived state param: this is what gates /callback since a raw browser redirect from Google carries no Authorization header. */
  private signState(): string {
    const issuedAt = Date.now();
    const signature = createHmac('sha256', this.stateSecret()).update(String(issuedAt)).digest('hex');
    return `${issuedAt}.${signature}`;
  }

  private verifyState(state: string): boolean {
    const [issuedAtRaw, signature] = state.split('.');
    if (!issuedAtRaw || !signature) return false;
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS || Date.now() < issuedAt) return false;
    const expected = createHmac('sha256', this.stateSecret()).update(issuedAtRaw).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private stateSecret(): string {
    return this.config.get<string>('auth.adminJwtSecret') ?? 'search-console-state-fallback-secret';
  }

  // AES-256-GCM encrypt/decrypt pair for the stored refresh token, mirroring PayoutDataSecurityService's
  // scheme (v1.<iv>.<tag>.<ciphertext>, all base64) but with decrypt added since this is read back on every refresh.
  private encrypt(plaintext: string): string {
    const key = this.encryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
  }

  private decrypt(stored: string): string {
    const [version, ivB64, tagB64, dataB64] = stored.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new ServiceUnavailableException('Stored Search Console refresh token is corrupted');
    }
    const key = this.encryptionKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }

  private encryptionKey(): Buffer {
    const raw = this.config.get<string>('taskerPayout.encryptionKey')?.trim();
    if (!raw) {
      throw new ServiceUnavailableException({
        code: 'SEARCH_CONSOLE_ENCRYPTION_NOT_CONFIGURED',
        message: 'Search Console refresh-token storage is disabled until PAYOUT_DATA_ENCRYPTION_KEY is configured.',
      });
    }
    if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
    throw new ServiceUnavailableException({
      code: 'SEARCH_CONSOLE_ENCRYPTION_NOT_CONFIGURED',
      message: 'PAYOUT_DATA_ENCRYPTION_KEY is not a valid 32-byte key (64 hex chars or base64).',
    });
  }
}
