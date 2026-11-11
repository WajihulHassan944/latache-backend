import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../../database/prisma.service';
import { AdminAuditService } from '../../admin-audit/admin-audit.service';
import { AppCacheService, CacheNamespace } from '../../../infrastructure/redis/app-cache.service';
import type { User } from '../../../generated/prisma/client';

const SETTING_KEY = 'google_analytics_ga4';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes - plenty for an admin to complete the Google consent screen.
const SUMMARY_CACHE_TTL_SECONDS = 3600;
const SUMMARY_ROW_LIMIT = 25;

interface StoredConnection {
  connected: boolean;
  propertyId: string | null;
  connectedAt: string | null;
  encryptedRefreshToken: string | null;
}

export interface TopPageRow {
  path: string;
  pageviews: number;
  users: number;
}

export interface GoogleAnalyticsSummary {
  sessions: number;
  users: number;
  pageviews: number;
  avgSessionDurationSeconds: number;
  topPages: TopPageRow[];
}

interface Ga4Row {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

const EMPTY_CONNECTION: StoredConnection = {
  connected: false,
  propertyId: null,
  connectedAt: null,
  encryptedRefreshToken: null,
};

@Injectable()
export class GoogleAnalyticsService {
  private readonly logger = new Logger(GoogleAnalyticsService.name);
  // Access tokens are short-lived (~1hr) and deliberately never persisted - held in-memory only,
  // re-minted from the stored refresh token.
  private accessToken: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cache: AppCacheService,
    private readonly audit: AdminAuditService,
  ) {}

  async status() {
    const connection = await this.connectionRow();
    return { connected: connection.connected, propertyId: connection.propertyId, connectedAt: connection.connectedAt };
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
    const success = `${frontendBase}/admin/seo-management?tab=market-research&ga4=success`;
    const failure = `${frontendBase}/admin/seo-management?tab=market-research&ga4=error`;
    try {
      if (!code || !state || !this.verifyState(state)) return failure;
      const { clientId, clientSecret, redirectUri, propertyId } = this.requireOAuthConfig();
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
        this.logger.error(`GA4 token exchange failed: ${response.status} ${detail.slice(0, 500)}`);
        return failure;
      }
      const payload = (await response.json()) as { refresh_token?: string; access_token?: string; expires_in?: number };
      if (!payload.refresh_token) {
        this.logger.error('GA4 token exchange did not return a refresh_token (prompt=consent should always issue one)');
        return failure;
      }
      const value = {
        connected: true,
        propertyId,
        connectedAt: new Date().toISOString(),
        encryptedRefreshToken: this.encrypt(payload.refresh_token),
      };
      await this.prisma.platformSetting.upsert({
        where: { key: SETTING_KEY },
        create: { key: SETTING_KEY, value },
        update: { value },
      });
      this.accessToken = payload.access_token && payload.expires_in
        ? { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 }
        : null;
      await this.audit.record({ action: 'seo_google_analytics_connected', entityType: 'seo_google_analytics', entityId: 'global', metadata: { propertyId } });
      return success;
    } catch (error) {
      this.logger.error(`GA4 callback failed: ${error instanceof Error ? error.message : String(error)}`);
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
    await this.audit.record({ actorId: actor.id, action: 'seo_google_analytics_disconnected', entityType: 'seo_google_analytics', entityId: 'global' });
    return { connected: false };
  }

  async summary(query: { startDate?: string; endDate?: string }): Promise<GoogleAnalyticsSummary> {
    const { startDate, endDate } = this.resolveRange(query);
    return this.cache.getOrLoad(CacheNamespace.AdminAnalytics, { operation: 'seo-ga4-summary', startDate, endDate }, SUMMARY_CACHE_TTL_SECONDS, () => this.fetchSummary(startDate, endDate));
  }

  private async fetchSummary(startDate: string, endDate: string): Promise<GoogleAnalyticsSummary> {
    const { propertyId } = this.requireOAuthConfig();
    const accessToken = await this.accessTokenOrThrow();
    const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`;
    const dateRanges = [{ startDate, endDate }];

    const [totals, pages] = await Promise.all([
      this.runReport(endpoint, accessToken, {
        dateRanges,
        metrics: [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }, { name: 'averageSessionDuration' }],
      }),
      this.runReport(endpoint, accessToken, {
        dateRanges,
        dimensions: [{ name: 'pagePath' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'activeUsers' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: SUMMARY_ROW_LIMIT,
      }),
    ]);

    const num = (row: Ga4Row | undefined, index: number) => Number(row?.metricValues?.[index]?.value ?? 0) || 0;
    const totalsRow = totals.rows?.[0];

    return {
      sessions: num(totalsRow, 0),
      users: num(totalsRow, 1),
      pageviews: num(totalsRow, 2),
      avgSessionDurationSeconds: num(totalsRow, 3),
      topPages: (pages.rows ?? []).map((row) => ({
        path: row.dimensionValues?.[0]?.value ?? '',
        pageviews: num(row, 0),
        users: num(row, 1),
      })),
    };
  }

  private async runReport(endpoint: string, accessToken: string, body: Record<string, unknown>): Promise<{ rows?: Ga4Row[] }> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`GA4_RUN_REPORT_FAILED_${response.status}:${detail.slice(0, 500)}`);
    }
    return (await response.json()) as { rows?: Ga4Row[] };
  }

  private async accessTokenOrThrow(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 5_000) return this.accessToken.token;
    const connection = await this.connectionRow();
    if (!connection.connected || !connection.encryptedRefreshToken) {
      throw new ServiceUnavailableException({
        code: 'GA4_NOT_CONNECTED',
        message: 'Google Analytics is not connected. Connect it from the SEO Management panel first.',
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
        code: 'GA4_TOKEN_REFRESH_FAILED',
        message: `Failed to refresh Google Analytics access token: ${response.status} ${detail.slice(0, 300)}`,
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
      propertyId: value.propertyId ?? null,
      connectedAt: value.connectedAt ?? null,
      encryptedRefreshToken: value.encryptedRefreshToken ?? null,
    };
  }

  private requireOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string; propertyId: string } {
    const clientId = this.config.get<string>('googleAnalytics.clientId');
    const clientSecret = this.config.get<string>('googleAnalytics.clientSecret');
    const redirectUri = this.config.get<string>('googleAnalytics.redirectUri');
    const propertyId = this.config.get<string>('googleAnalytics.propertyId');
    if (!clientId || !clientSecret || !redirectUri || !propertyId) {
      throw new ServiceUnavailableException({
        code: 'GA4_NOT_CONFIGURED',
        message: 'Google Analytics integration is disabled until GOOGLE_ANALYTICS_CLIENT_ID, GOOGLE_ANALYTICS_CLIENT_SECRET and GOOGLE_ANALYTICS_PROPERTY_ID are configured.',
      });
    }
    return { clientId, clientSecret, redirectUri, propertyId };
  }

  /** Signed, short-lived state param: this is what gates /callback since a raw browser redirect from Google carries no Authorization header. */
  private signState(): string {
    const issuedAt = Date.now();
    const signature = createHmac('sha256', this.stateSecret()).update(`ga4.${issuedAt}`).digest('hex');
    return `${issuedAt}.${signature}`;
  }

  private verifyState(state: string): boolean {
    const [issuedAtRaw, signature] = state.split('.');
    if (!issuedAtRaw || !signature) return false;
    const issuedAt = Number(issuedAtRaw);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS || Date.now() < issuedAt) return false;
    const expected = createHmac('sha256', this.stateSecret()).update(`ga4.${issuedAtRaw}`).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    const actualBuffer = Buffer.from(signature, 'hex');
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  private stateSecret(): string {
    return this.config.get<string>('auth.adminJwtSecret') ?? 'ga4-state-fallback-secret';
  }

  // AES-256-GCM, same v1.<iv>.<tag>.<ciphertext> scheme as the Search Console token store.
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
      throw new ServiceUnavailableException('Stored Google Analytics refresh token is corrupted');
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
        code: 'GA4_ENCRYPTION_NOT_CONFIGURED',
        message: 'Google Analytics refresh-token storage is disabled until PAYOUT_DATA_ENCRYPTION_KEY is configured.',
      });
    }
    if (/^[a-fA-F0-9]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 32) return decoded;
    throw new ServiceUnavailableException({
      code: 'GA4_ENCRYPTION_NOT_CONFIGURED',
      message: 'PAYOUT_DATA_ENCRYPTION_KEY is not a valid 32-byte key (64 hex chars or base64).',
    });
  }
}
