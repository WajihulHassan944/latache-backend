import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface AdminAuditEventInput {
  actorId?: number | null;
  targetUserId?: number | null;
  action: string;
  entityType: string;
  entityId?: string | number | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

@Injectable()
export class AdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(
    input: AdminAuditEventInput,
    transaction?: Prisma.TransactionClient,
  ) {
    const client = transaction ?? this.prisma;
    return client.adminAuditLog.create({
      data: {
        actorId: input.actorId ?? null,
        targetUserId: input.targetUserId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId:
          input.entityId === undefined || input.entityId === null
            ? null
            : String(input.entityId),
        reason: input.reason?.trim() || null,
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : Prisma.DbNull,
      },
    });
  }
}
