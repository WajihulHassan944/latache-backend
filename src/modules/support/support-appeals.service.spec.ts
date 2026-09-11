import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { SupportService } from './support.service';

describe('SupportService — appeals', () => {
  const password = 'CorrectPassword123!';
  let passwordHash: string;

  beforeAll(async () => {
    passwordHash = await hash(password, 4);
  });

  const taskerUser = {
    id: 42,
    role: 'tasker',
    email: 'tasker@example.com',
    accountStatus: 'suspended',
    deletedAt: null,
  };

  function buildService() {
    const prisma = {
      user: { findUnique: jest.fn() },
      customerProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      taskerProfile: { findUnique: jest.fn().mockResolvedValue(null) },
      supportTicket: { findFirst: jest.fn() },
    };
    const config = { get: jest.fn().mockReturnValue(4) };
    const service = new SupportService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      config as never,
    );
    return { service, prisma };
  }

  describe('createAppeal — duplicate open appeal', () => {
    it('rejects with 409 APPEAL_ALREADY_OPEN when an unresolved appeal ticket already exists', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ ...taskerUser, password: passwordHash });
      prisma.supportTicket.findFirst.mockResolvedValue({ id: 9, status: 'open' });

      let caught: unknown;
      try {
        await service.createAppeal({
          email: taskerUser.email,
          password,
          message: 'x'.repeat(20),
        } as never);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getResponse()).toMatchObject({
        code: 'APPEAL_ALREADY_OPEN',
      });
      expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith({
        where: {
          userId: taskerUser.id,
          requesterRole: taskerUser.role,
          category: 'appeal',
          status: { in: ['open', 'waiting', 'in_progress', 'escalated'] },
        },
      });
    });

    it('proceeds to create a ticket once the account has no unresolved appeal', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ ...taskerUser, password: passwordHash });
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      const createSpy = jest.spyOn(service, 'create').mockResolvedValue({ id: 1 } as never);

      await service.createAppeal({
        email: taskerUser.email,
        password,
        message: 'x'.repeat(20),
      } as never);

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: taskerUser.id }),
        expect.objectContaining({ category: 'appeal' }),
      );
    });

  });

  describe('appealStatus', () => {
    it('rejects invalid credentials', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.appealStatus({ email: 'nope@example.com', password: 'x' } as never),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns 404 when the account has no appeal ticket', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ ...taskerUser, password: passwordHash });
      prisma.supportTicket.findFirst.mockResolvedValue(null);
      await expect(
        service.appealStatus({ email: taskerUser.email, password } as never),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the most recent appeal ticket status', async () => {
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ ...taskerUser, password: passwordHash });
      prisma.supportTicket.findFirst.mockResolvedValue({
        id: 7,
        status: 'resolved',
        resolutionSummary: 'Reinstated after review',
        resolvedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.appealStatus({ email: taskerUser.email, password } as never);

      expect(result).toEqual({
        ticketId: '7',
        status: 'resolved',
        resolutionSummary: 'Reinstated after review',
        resolvedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(prisma.supportTicket.findFirst).toHaveBeenCalledWith({
        where: { userId: taskerUser.id, requesterRole: taskerUser.role, category: 'appeal' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });
});
