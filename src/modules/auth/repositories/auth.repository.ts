import { Injectable } from '@nestjs/common';
import type { Prisma, User } from '../../../generated/prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findUserByEmail(email: string, transaction?: Prisma.TransactionClient): Promise<User | null> {
    return (transaction ?? this.prisma).user.findFirst({
      where: { email: { equals: email.trim().toLowerCase(), mode: 'insensitive' } },
    });
  }

  findUserById(id: number, transaction?: Prisma.TransactionClient): Promise<User | null> {
    return (transaction ?? this.prisma).user.findUnique({ where: { id } });
  }

  createUser(
    data: Prisma.UserUncheckedCreateInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<User> {
    return (transaction ?? this.prisma).user.create({ data });
  }

  updateUser(
    id: number,
    data: Prisma.UserUncheckedUpdateInput,
    transaction?: Prisma.TransactionClient,
  ): Promise<User> {
    return (transaction ?? this.prisma).user.update({ where: { id }, data });
  }

  async findUserByIdForUpdate(
    id: number,
    transaction: Prisma.TransactionClient,
  ): Promise<User | null> {
    const rows = await transaction.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "Users" WHERE "id" = ${id} FOR UPDATE
    `;
    return rows.length === 0 ? null : transaction.user.findUnique({ where: { id } });
  }

  countServices(serviceIds: number[], transaction?: Prisma.TransactionClient): Promise<number> {
    return (transaction ?? this.prisma).service.count({ where: { id: { in: serviceIds } } });
  }

  transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(callback);
  }
}
