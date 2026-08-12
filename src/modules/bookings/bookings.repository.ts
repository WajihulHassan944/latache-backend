import { Injectable } from '@nestjs/common';
import { dateOnlyToDate } from '../../common/utils/date.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type UserAvailability, type UserService } from '../../generated/prisma/client';

@Injectable()
export class BookingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findTaskerServiceRate(
    taskerId: number,
    serviceId: number,
    transaction: Prisma.TransactionClient,
  ): Promise<UserService | null> {
    return transaction.userService.findUnique({
      where: { userId_serviceId: { userId: taskerId, serviceId } },
    });
  }

  async findOpenSlotsForDate(
    taskerId: number,
    date: string,
    transaction: Prisma.TransactionClient,
  ): Promise<UserAvailability[]> {
    const ids = await transaction.$queryRaw<Array<{ id: number }>>`
      SELECT "id"
      FROM "UserAvailabilities"
      WHERE "userId" = ${taskerId}
        AND "date" = ${dateOnlyToDate(date)}
        AND "isBooked" = false
      ORDER BY "id"
      FOR UPDATE
    `;
    if (!ids.length) return [];
    return transaction.userAvailability.findMany({
      where: { id: { in: ids.map((row) => row.id) } },
    });
  }

  async claimSlot(availabilityId: number, transaction: Prisma.TransactionClient): Promise<boolean> {
    const result = await transaction.userAvailability.updateMany({
      where: { id: availabilityId, isBooked: false },
      data: { isBooked: true },
    });
    return result.count === 1;
  }
}
