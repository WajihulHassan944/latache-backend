import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { CustomerAddress, Prisma } from '../../generated/prisma/client';
import { CreateAddressDto, UpdateAddressDto } from './addresses.dto';

export interface AddressView {
  id: string;
  label: string;
  address: string;
  latitude: number;
  longitude: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class AddressesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(customerId: number): Promise<AddressView[]> {
    const rows = await this.prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  /** Used by GET /api/taskers as its Customer discovery-search fallback location. */
  async getDefaultLocation(
    customerId: number,
  ): Promise<{ latitude: Prisma.Decimal; longitude: Prisma.Decimal } | null> {
    const address = await this.prisma.customerAddress.findFirst({
      where: { customerId, isDefault: true },
      select: { latitude: true, longitude: true },
    });
    return address ?? null;
  }

  async create(customerId: number, dto: CreateAddressDto): Promise<AddressView> {
    const created = await this.prisma.$transaction(async (transaction) => {
      const existingCount = await transaction.customerAddress.count({ where: { customerId } });
      const makeDefault = dto.isDefault === true || existingCount === 0;
      if (makeDefault) {
        await transaction.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }
      return transaction.customerAddress.create({
        data: {
          customerId,
          label: dto.label,
          address: dto.address,
          latitude: dto.latitude,
          longitude: dto.longitude,
          isDefault: makeDefault,
        },
      });
    });
    return this.serialize(created);
  }

  async update(customerId: number, id: string, dto: UpdateAddressDto): Promise<AddressView> {
    await this.requireOwnedAddress(customerId, id);
    const updated = await this.prisma.$transaction(async (transaction) => {
      if (dto.isDefault === true) {
        await transaction.customerAddress.updateMany({
          where: { customerId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return transaction.customerAddress.update({
        where: { id },
        data: {
          ...(dto.label !== undefined ? { label: dto.label } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.latitude !== undefined ? { latitude: dto.latitude } : {}),
          ...(dto.longitude !== undefined ? { longitude: dto.longitude } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        },
      });
    });
    return this.serialize(updated);
  }

  async delete(customerId: number, id: string): Promise<{ deleted: true; id: string }> {
    const address = await this.requireOwnedAddress(customerId, id);
    await this.prisma.$transaction(async (transaction) => {
      await transaction.customerAddress.delete({ where: { id } });
      if (address.isDefault) {
        const replacement = await transaction.customerAddress.findFirst({
          where: { customerId, id: { not: id } },
          orderBy: { createdAt: 'asc' },
        });
        if (replacement) {
          await transaction.customerAddress.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }
    });
    return { deleted: true, id };
  }

  private async requireOwnedAddress(customerId: number, id: string): Promise<CustomerAddress> {
    const address = await this.prisma.customerAddress.findFirst({
      where: { id, customerId },
    });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  private serialize(address: CustomerAddress): AddressView {
    return {
      id: address.id,
      label: address.label,
      address: address.address,
      latitude: Number(address.latitude),
      longitude: Number(address.longitude),
      isDefault: address.isDefault,
      createdAt: address.createdAt.toISOString(),
      updatedAt: address.updatedAt.toISOString(),
    };
  }
}
