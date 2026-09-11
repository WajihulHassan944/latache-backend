import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { User } from '../../../generated/prisma/client';
import { AdminTaskersService } from './admin-taskers.service';

describe('AdminTaskersService', () => {
  const baseTasker = {
    id: 58,
    firstName: 'Sarah',
    lastName: 'Ahmed',
    email: 'sarah@example.com',
    phoneCountryCode: '+212',
    phoneNumber: '612345678',
    profilePicture: null,
    bio: null,
    accountStatus: 'active',
    onboardingStatus: 'approved',
    isVerified: true,
    isDocVerified: true,
    isElite: false,
    rating: 4.5,
    reviewsCount: 10,
    completedTasks: 20,
    yearsOfExperience: 2,
    serviceAreaCity: 'Casablanca',
    serviceAreaArea: 'Maarif',
    submittedAt: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    taskerProfile: {
      status: 'active',
      rating: 4.5,
      reviewsCount: 10,
      reapplyCount: 0,
      lastRejectedAt: null,
      lastRejectionReason: null,
      lastRejectionReasonCode: null,
    },
  };

  const actor = { id: 1 } as User;

  function buildService() {
    const prisma = {
      user: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      booking: { groupBy: jest.fn().mockResolvedValue([]) },
      taskerWalletLedgerEntry: { groupBy: jest.fn().mockResolvedValue([]) },
    };
    Object.assign(prisma, {
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback(prisma)),
    });
    const sessions = { revokeRole: jest.fn() };
    const notifications = { create: jest.fn() };
    const audit = { record: jest.fn() };
    const accountDeletion = { permanentlyDelete: jest.fn() };
    const service = new AdminTaskersService(
      prisma as never,
      sessions as never,
      notifications as never,
      audit as never,
      accountDeletion as never,
    );
    return { service, prisma, audit };
  }

  describe('updateProfile', () => {
    it('rejects when no field is provided', async () => {
      const { service } = buildService();
      await expect(service.updateProfile(actor, 58, {})).rejects.toThrow(BadRequestException);
    });

    it('throws 404 when the tasker does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(service.updateProfile(actor, 999, { firstName: 'New' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('updates only the provided fields and returns the AdminTaskerRow shape', async () => {
      const { service, prisma, audit } = buildService();
      prisma.user.findFirst.mockResolvedValue(baseTasker);
      prisma.user.update.mockResolvedValue({
        ...baseTasker,
        firstName: 'Sara',
        phoneNumber: '699999999',
      });

      const result = await service.updateProfile(actor, 58, {
        firstName: 'Sara',
        phoneNumber: '699999999',
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 58 },
        data: { firstName: 'Sara', phoneNumber: '699999999' },
        include: { taskerProfile: true },
      });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tasker_profile_updated', targetUserId: 58 }),
        prisma,
      );
      expect(result.user).toMatchObject({
        id: '58',
        firstName: 'Sara',
        phoneNumber: '699999999',
        email: 'sarah@example.com',
      });
    });
  });

  describe('list — completion rate', () => {
    it('computes completionRate as completed/(completed+cancelled), 0 with no such bookings', async () => {
      const { service, prisma } = buildService();
      const rowA = { ...baseTasker, id: 1, _count: { userServices: 1, bookingsAsTasker: 4 } };
      const rowB = { ...baseTasker, id: 2, _count: { userServices: 1, bookingsAsTasker: 0 } };
      prisma.user.findMany.mockResolvedValue([rowA, rowB]);
      prisma.user.count.mockResolvedValue(2);
      prisma.booking.groupBy.mockResolvedValue([
        { taskerId: 1, status: 'completed', _count: { _all: 3 } },
        { taskerId: 1, status: 'cancelled', _count: { _all: 1 } },
      ]);

      const result = await service.list({ page: 1, limit: 20 } as never);

      expect(result.items.find((item) => item.id === '1')?.completionRate).toBe(75);
      expect(result.items.find((item) => item.id === '2')?.completionRate).toBe(0);
    });

    it('sorts by completion_rate_desc across the whole matching set before paginating', async () => {
      const { service, prisma } = buildService();
      const candidates = [
        { id: 1, createdAt: new Date('2024-01-01') },
        { id: 2, createdAt: new Date('2024-02-01') },
        { id: 3, createdAt: new Date('2024-03-01') },
      ];
      prisma.user.findMany
        .mockResolvedValueOnce(candidates)
        .mockResolvedValueOnce([
          { ...baseTasker, id: 2, _count: { userServices: 0, bookingsAsTasker: 0 } },
          { ...baseTasker, id: 1, _count: { userServices: 0, bookingsAsTasker: 0 } },
        ]);
      prisma.user.count.mockResolvedValue(3);
      prisma.booking.groupBy.mockResolvedValue([
        { taskerId: 1, status: 'completed', _count: { _all: 1 } },
        { taskerId: 1, status: 'cancelled', _count: { _all: 1 } },
        { taskerId: 2, status: 'completed', _count: { _all: 5 } },
      ]);

      const result = await service.list({ page: 1, limit: 2, sort: 'completion_rate_desc' } as never);

      expect(result.items.map((item) => item.id)).toEqual(['2', '1']);
      expect(result.pagination.totalItems).toBe(3);
    });
  });
});
