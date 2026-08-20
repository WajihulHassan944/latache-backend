import { Injectable } from '@nestjs/common';
import type { Prisma, RefreshToken } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class AuthSessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.RefreshTokenUncheckedCreateInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<RefreshToken> {
    return (transaction ?? this.prisma).refreshToken.create({ data });
  }

  findByHash(
    tokenHash: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<RefreshToken | null> {
    return (transaction ?? this.prisma).refreshToken.findUnique({ where: { tokenHash } });
  }

  findActiveById(id: number, userId: number): Promise<RefreshToken | null> {
    return this.prisma.refreshToken.findFirst({
      where: {
        id,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  listActive(userId: number): Promise<RefreshToken[]> {
    return this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  revokeById(userId: number, id: number): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeByHash(userId: number, tokenHash: string): Promise<Prisma.BatchPayload> {
    return this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeAll(userId: number, transaction?: Prisma.TransactionClient): Promise<Prisma.BatchPayload> {
    return (transaction ?? this.prisma).refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  revokeRole(
    userId: number,
    activeRole: string,
    transaction?: Prisma.TransactionClient,
  ): Promise<Prisma.BatchPayload> {
    return (transaction ?? this.prisma).refreshToken.updateMany({
      where: { userId, activeRole, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async lockByHash(
    tokenHash: string,
    transaction: Prisma.TransactionClient,
  ): Promise<RefreshToken | null> {
    const rows = await transaction.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "RefreshTokens" WHERE "tokenHash" = ${tokenHash} FOR UPDATE
    `;
    return rows.length === 0 ? null : transaction.refreshToken.findUnique({ where: { tokenHash } });
  }
}
