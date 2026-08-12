import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: number, transaction?: Prisma.TransactionClient): Promise<User | null> {
    return (transaction ?? this.prisma).user.findUnique({ where: { id } });
  }

  findByEmail(email: string, transaction?: Prisma.TransactionClient): Promise<User | null> {
    return (transaction ?? this.prisma).user.findFirst({
      where: {
        email: {
          equals: email.trim().toLowerCase(),
          mode: 'insensitive',
        },
      },
    });
  }

  create(
    data: Prisma.UserUncheckedCreateInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<User> {
    return (transaction ?? this.prisma).user.create({ data });
  }

  async updateById(
    id: number,
    data: Prisma.UserUncheckedUpdateInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<boolean> {
    try {
      await (transaction ?? this.prisma).user.update({ where: { id }, data });
      return true;
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2025')) return false;
      throw error;
    }
  }

  async findByIdForUpdate(id: number, transaction: Prisma.TransactionClient): Promise<User | null> {
    const rows = await transaction.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Users" WHERE "id" = ${id} FOR UPDATE
    `;
    if (rows.length === 0) return null;
    return transaction.user.findUnique({ where: { id } });
  }
}
