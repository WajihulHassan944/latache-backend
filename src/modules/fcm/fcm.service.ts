import { createHash, createSign, randomUUID } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import type { RegisterFcmTokenDto } from './fcm.dto';

type ClaimedDelivery = {
  id: string;
  token: string;
  tokenId: string;
  notificationId: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
};

@Injectable()
export class FcmService {
  private accessToken?: { value: string; expiresAt: number };

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.config.get<boolean>('fcm.enabled', false);
  }

  async registerToken(userId: number, input: RegisterFcmTokenDto): Promise<{ registered: true }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Push notifications are not enabled');
    }
    const token = input.token.trim();
    const tokenHash = this.hashToken(token);
    await this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.$queryRaw<Array<{ id: string; userId: number }>>(Prisma.sql`
        SELECT "id", "userId" FROM "FcmDeviceTokens" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
      `);
      const current = existing[0];
      if (current && current.userId !== userId) {
        // A browser/device token can move between accounts after logout/login.
        // Remove queued deliveries first so a previous account's notification can
        // never be delivered to the newly authenticated account.
        await transaction.$executeRaw(Prisma.sql`
          DELETE FROM "FcmPushDeliveries"
          WHERE "deviceTokenId" = ${current.id} AND "status" IN ('pending', 'processing')
        `);
      }
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "FcmDeviceTokens"
          ("id", "userId", "tokenHash", "token", "platform", "deviceId", "enabled", "lastSeenAt", "createdAt", "updatedAt")
        VALUES
          (${current?.id ?? randomUUID()}, ${userId}, ${tokenHash}, ${token}, ${input.platform}, ${input.deviceId?.trim() || null}, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("tokenHash") DO UPDATE SET
          "userId" = EXCLUDED."userId",
          "token" = EXCLUDED."token",
          "platform" = EXCLUDED."platform",
          "deviceId" = EXCLUDED."deviceId",
          "enabled" = true,
          "lastSeenAt" = CURRENT_TIMESTAMP,
          "disabledAt" = NULL,
          "lastError" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      `);
    });
    return { registered: true };
  }

  async removeToken(userId: number, token: string): Promise<{ removed: boolean }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Push notifications are not enabled');
    }
    const result = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "FcmDeviceTokens"
      SET "enabled" = false, "disabledAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "userId" = ${userId} AND "tokenHash" = ${this.hashToken(token.trim())}
    `);
    return { removed: result > 0 };
  }

  async enqueueNotification(
    userId: number,
    notificationId: string,
    title: string,
    body: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<number> {
    if (!this.isEnabled()) return 0;
    const client = transaction ?? this.prisma;
    const result = await client.$executeRaw(Prisma.sql`
      INSERT INTO "FcmPushDeliveries"
        ("id", "notificationId", "deviceTokenId", "title", "body", "status", "attempts", "nextAttemptAt", "createdAt", "updatedAt")
      SELECT
        ${randomUUID()} || '-' || md5(t."id" || ${notificationId} || clock_timestamp()::text),
        ${notificationId},
        t."id",
        ${title},
        ${body},
        'pending',
        0,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      FROM "FcmDeviceTokens" t
      WHERE t."userId" = ${userId} AND t."enabled" = true
      ON CONFLICT ("notificationId", "deviceTokenId") DO NOTHING
    `);
    return result;
  }

  async runOnce(): Promise<{ processed: number; sent: number; failed: number }> {
    if (!this.isEnabled()) return { processed: 0, sent: 0, failed: 0 };
    const batchSize = this.config.get<number>('fcm.batchSize', 50);
    const lockMs = this.config.get<number>('fcm.lockMs', 30_000);
    const lockToken = randomUUID();

    const claimed = await this.prisma.$queryRaw<ClaimedDelivery[]>(Prisma.sql`
      WITH candidates AS (
        SELECT d."id"
        FROM "FcmPushDeliveries" d
        WHERE (
          d."status" = 'pending' AND d."nextAttemptAt" <= CURRENT_TIMESTAMP
        ) OR (
          d."status" = 'processing' AND d."lockedAt" < CURRENT_TIMESTAMP - (${lockMs} * INTERVAL '1 millisecond')
        )
        ORDER BY d."nextAttemptAt" ASC, d."createdAt" ASC, d."id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE "FcmPushDeliveries" d
      SET "status" = 'processing', "lockedAt" = CURRENT_TIMESTAMP, "lockToken" = ${lockToken}, "updatedAt" = CURRENT_TIMESTAMP
      FROM candidates c
      WHERE d."id" = c."id"
      RETURNING d."id",
        (SELECT t."token" FROM "FcmDeviceTokens" t WHERE t."id" = d."deviceTokenId") AS "token",
        d."deviceTokenId" AS "tokenId",
        d."notificationId" AS "notificationId",
        d."title" AS "title",
        d."body" AS "body",
        (SELECT n."entityType" FROM "TaskNotifications" n WHERE n."id" = d."notificationId") AS "entityType",
        (SELECT n."entityId" FROM "TaskNotifications" n WHERE n."id" = d."notificationId") AS "entityId",
        (SELECT n."metadata" FROM "TaskNotifications" n WHERE n."id" = d."notificationId") AS "metadata"
    `);

    let sent = 0;
    let failed = 0;
    for (const delivery of claimed) {
      try {
        const result = await this.send(delivery);
        if (result === 'invalid-token') {
          await this.disableToken(delivery.tokenId, 'FCM rejected the registration token');
          await this.markFailed(delivery.id, lockToken, 'Invalid or unregistered FCM token', false);
          failed += 1;
        } else {
          await this.markSent(delivery.id, lockToken);
          sent += 1;
        }
      } catch (error) {
        const retryable = this.isRetryable(error);
        await this.markFailed(delivery.id, lockToken, this.errorMessage(error), retryable);
        failed += 1;
      }
    }
    return { processed: claimed.length, sent, failed };
  }

  private async send(delivery: ClaimedDelivery): Promise<'sent' | 'invalid-token'> {
    const projectId = this.config.getOrThrow<string>('fcm.projectId');
    const token = await this.getAccessToken();
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: delivery.token,
          notification: { title: delivery.title, body: delivery.body },
          data: {
            ...(delivery.metadata && typeof delivery.metadata === 'object'
              ? Object.fromEntries(
                  Object.entries(delivery.metadata as Record<string, unknown>)
                    .filter(([key]) => !['notificationId', 'entityType', 'entityId'].includes(key))
                    .map(([key, value]) => [key, this.stringifyData(value)]),
                )
              : {}),
            notificationId: delivery.notificationId,
            ...(delivery.entityType ? { entityType: delivery.entityType } : {}),
            ...(delivery.entityId ? { entityId: delivery.entityId } : {}),
          },
        },
      }),
    });

    if (response.ok) return 'sent';
    const text = (await response.text()).slice(0, 2000);
    if (response.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/i.test(text) && /token|registration/i.test(text)) {
      return 'invalid-token';
    }
    const error = new Error(`FCM HTTP ${response.status}: ${text}`);
    Object.assign(error, { status: response.status });
    throw error;
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const clientEmail = this.config.getOrThrow<string>('fcm.clientEmail');
    const privateKey = this.config.getOrThrow<string>('fcm.privateKey').replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);
    const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = base64url(JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }));
    const unsigned = `${header}.${payload}`;
    const signer = createSign('RSA-SHA256');
    signer.update(unsigned);
    const assertion = `${unsigned}.${signer.sign(privateKey, 'base64url')}`;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });
    if (!response.ok) throw new Error(`Google OAuth token request failed with HTTP ${response.status}`);
    const data = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('Google OAuth token response did not contain access_token');
    this.accessToken = {
      value: data.access_token,
      expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 60) * 1000,
    };
    return data.access_token;
  }

  private async markSent(id: string, lockToken: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "FcmPushDeliveries"
      SET "status" = 'sent', "sentAt" = CURRENT_TIMESTAMP, "lockedAt" = NULL, "lockToken" = NULL, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "lockToken" = ${lockToken}
    `);
  }

  private async markFailed(id: string, lockToken: string, error: string, retryable: boolean): Promise<void> {
    const maxAttempts = this.config.get<number>('fcm.maxAttempts', 8);
    const baseMs = this.config.get<number>('fcm.retryBaseMs', 2_000);
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "FcmPushDeliveries"
      SET
        "attempts" = "attempts" + 1,
        "status" = CASE WHEN NOT ${retryable} OR "attempts" + 1 >= ${maxAttempts} THEN 'failed' ELSE 'pending' END,
        "nextAttemptAt" = CASE WHEN NOT ${retryable} OR "attempts" + 1 >= ${maxAttempts} THEN CURRENT_TIMESTAMP ELSE CURRENT_TIMESTAMP + (LEAST(${baseMs} * POWER(2, "attempts"), 3600000) * INTERVAL '1 millisecond') END,
        "lastError" = ${error.slice(0, 1000)},
        "lockedAt" = NULL,
        "lockToken" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "lockToken" = ${lockToken}
    `);
  }

  private async disableToken(tokenId: string, reason: string): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "FcmDeviceTokens"
      SET "enabled" = false, "disabledAt" = CURRENT_TIMESTAMP, "lastError" = ${reason}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${tokenId}
    `);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private stringifyData(value: unknown): string {
    if (typeof value === 'string') return value.slice(0, 1000);
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value).slice(0, 1000);
  }

  private isRetryable(error: unknown): boolean {
    const status = (error as { status?: number })?.status;
    return status === undefined || status === 408 || status === 429 || status >= 500;
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  }
}
