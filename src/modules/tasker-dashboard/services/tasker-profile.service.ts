import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountStatus } from '../../../common/enums/account-status.enum';
import { UserRole } from '../../../common/enums/user-role.enum';
import { AuthSessionsRepository } from '../../auth/repositories/auth-sessions.repository';
import { PrismaService } from '../../../database/prisma.service';
import type { Prisma } from '../../../generated/prisma/client';
import type {
  TaskerBusinessProfileView,
  TaskerPersonalProfileView,
  TaskerSkillView,
} from '../tasker-dashboard.contracts';
import { TASKER_BOOKING_STATUS, WITHDRAWAL_STATUS } from '../tasker-dashboard.constants';
import type {
  ActivateTaskerSkillDto,
  UpdateTaskerBusinessProfileDto,
  UpdateTaskerPersonalProfileDto,
  UpdateTaskerSkillDto,
} from '../dto';

const ACTIVE_TASK_STATUSES = [
  TASKER_BOOKING_STATUS.Pending,
  TASKER_BOOKING_STATUS.Confirmed,
  TASKER_BOOKING_STATUS.EnRoute,
  TASKER_BOOKING_STATUS.Arrived,
  TASKER_BOOKING_STATUS.InProgress,
] as const;

@Injectable()
export class TaskerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: AuthSessionsRepository,
  ) {}

  async personal(taskerId: number): Promise<TaskerPersonalProfileView> {
    const user = await this.requireTasker(taskerId);
    return this.personalView(user);
  }

  async updatePersonal(
    taskerId: number,
    dto: UpdateTaskerPersonalProfileDto,
  ): Promise<TaskerPersonalProfileView> {
    await this.requireTasker(taskerId);
    const updated = await this.prisma.user.update({
      where: { id: taskerId },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.phoneCountryCode !== undefined ? { phoneCountryCode: dto.phoneCountryCode } : {}),
        ...(dto.phoneNumber !== undefined ? { phoneNumber: dto.phoneNumber } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.profilePicture !== undefined ? { profilePicture: dto.profilePicture } : {}),
      },
    });
    return this.personalView(updated);
  }

  async business(taskerId: number): Promise<TaskerBusinessProfileView> {
    const user = await this.requireTasker(taskerId);
    const skills = await this.listSkills(taskerId);
    return this.businessView(user, skills);
  }

  async updateBusiness(
    taskerId: number,
    dto: UpdateTaskerBusinessProfileDto,
  ): Promise<TaskerBusinessProfileView> {
    await this.requireTasker(taskerId);
    const hasLat = dto.serviceAreaLat !== undefined;
    const hasLng = dto.serviceAreaLng !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException('serviceAreaLat and serviceAreaLng must be updated together');
    }

    const updated = await this.prisma.user.update({
      where: { id: taskerId },
      data: {
        ...(dto.yearsOfExperience !== undefined
          ? { yearsOfExperience: dto.yearsOfExperience }
          : {}),
        ...(dto.serviceAreaArea !== undefined ? { serviceAreaArea: dto.serviceAreaArea } : {}),
        ...(dto.serviceAreaCity !== undefined ? { serviceAreaCity: dto.serviceAreaCity } : {}),
        ...(dto.serviceAreaLabel !== undefined ? { serviceAreaLabel: dto.serviceAreaLabel } : {}),
        ...(dto.serviceAreaLat !== undefined ? { serviceAreaLat: dto.serviceAreaLat } : {}),
        ...(dto.serviceAreaLng !== undefined ? { serviceAreaLng: dto.serviceAreaLng } : {}),
        ...(dto.serviceAreaRadiusKm !== undefined
          ? { serviceAreaRadiusKm: dto.serviceAreaRadiusKm }
          : {}),
        ...(dto.isProfilePublic !== undefined ? { isProfilePublic: dto.isProfilePublic } : {}),
      },
    });
    return this.businessView(updated, await this.listSkills(taskerId));
  }

  async listSkills(taskerId: number): Promise<TaskerSkillView[]> {
    await this.requireTasker(taskerId);
    const [catalogue, active] = await Promise.all([
      this.prisma.service.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.userService.findMany({ where: { userId: taskerId } }),
    ]);
    const byService = new Map(active.map((row) => [row.serviceId, row]));
    return catalogue.map((service) => {
      const selected = byService.get(service.id);
      return {
        serviceId: String(service.id),
        slug: service.slug ?? '',
        name: service.name ?? '',
        description: service.description ?? '',
        icon: service.icon ?? '',
        active: Boolean(selected),
        hourlyRate: selected ? Number(selected.hourlyRate) : null,
      };
    });
  }

  async activateSkill(taskerId: number, dto: ActivateTaskerSkillDto): Promise<TaskerSkillView> {
    await this.requireTasker(taskerId);
    const service = await this.prisma.service.findFirst({
      where: { slug: dto.serviceSlug, isActive: true },
    });
    if (!service) throw new NotFoundException('Service not found');

    const selected = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.userService.upsert({
        where: {
          userId_serviceId: { userId: taskerId, serviceId: service.id },
        },
        create: {
          userId: taskerId,
          serviceId: service.id,
          hourlyRate: dto.hourlyRate.toFixed(2),
        },
        update: { hourlyRate: dto.hourlyRate.toFixed(2) },
      });
      await this.syncTaskerSkillSnapshot(taskerId, transaction);
      return row;
    });

    return {
      serviceId: String(service.id),
      slug: service.slug ?? '',
      name: service.name ?? '',
      description: service.description ?? '',
      icon: service.icon ?? '',
      active: true,
      hourlyRate: Number(selected.hourlyRate),
    };
  }

  async updateSkill(
    taskerId: number,
    serviceId: number,
    dto: UpdateTaskerSkillDto,
  ): Promise<TaskerSkillView> {
    await this.requireTasker(taskerId);
    const existing = await this.prisma.userService.findUnique({
      where: { userId_serviceId: { userId: taskerId, serviceId } },
      include: { service: true },
    });
    if (!existing) throw new NotFoundException('Active skill not found');
    const updated = await this.prisma.$transaction(async (transaction) => {
      const row = await transaction.userService.update({
        where: { userId_serviceId: { userId: taskerId, serviceId } },
        data: { hourlyRate: dto.hourlyRate.toFixed(2) },
      });
      await this.syncTaskerSkillSnapshot(taskerId, transaction);
      return row;
    });
    return {
      serviceId: String(serviceId),
      slug: existing.service.slug ?? '',
      name: existing.service.name ?? '',
      description: existing.service.description ?? '',
      icon: existing.service.icon ?? '',
      active: true,
      hourlyRate: Number(updated.hourlyRate),
    };
  }

  async deactivateSkill(
    taskerId: number,
    serviceId: number,
  ): Promise<{ deactivated: true; serviceId: string }> {
    await this.requireTasker(taskerId);
    const existing = await this.prisma.userService.findUnique({
      where: { userId_serviceId: { userId: taskerId, serviceId } },
    });
    if (!existing) throw new NotFoundException('Active skill not found');
    const activeBookings = await this.prisma.booking.count({
      where: {
        taskerId,
        serviceId,
        status: { in: [...ACTIVE_TASK_STATUSES] },
      },
    });
    if (activeBookings > 0) {
      throw new ConflictException('This skill cannot be deactivated while active bookings use it');
    }
    await this.prisma.$transaction(async (transaction) => {
      await transaction.userService.delete({
        where: { userId_serviceId: { userId: taskerId, serviceId } },
      });
      await this.syncTaskerSkillSnapshot(taskerId, transaction);
    });
    return { deactivated: true, serviceId: String(serviceId) };
  }

  async deactivateAccount(taskerId: number): Promise<{ deactivated: true }> {
    await this.requireTasker(taskerId);
    const [activeBookings, wallet, activeWithdrawals] = await Promise.all([
      this.prisma.booking.count({
        where: { taskerId, status: { in: [...ACTIVE_TASK_STATUSES] } },
      }),
      this.prisma.taskerWallet.findUnique({ where: { taskerId } }),
      this.prisma.taskerWithdrawal.count({
        where: {
          taskerId,
          status: {
            in: [WITHDRAWAL_STATUS.PendingReview, WITHDRAWAL_STATUS.Processing],
          },
        },
      }),
    ]);
    if (activeBookings > 0) {
      throw new ConflictException(
        'Finish or cancel active bookings before deactivating the account',
      );
    }
    if (wallet && (Number(wallet.availableBalance) > 0 || Number(wallet.pendingBalance) > 0)) {
      throw new ConflictException(
        'Withdraw or settle the remaining wallet balance before deactivating the account',
      );
    }
    if (activeWithdrawals > 0) {
      throw new ConflictException('Resolve pending withdrawals before deactivating the account');
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.user.update({
        where: { id: taskerId },
        data: {
          accountStatus: AccountStatus.Deactivated,
          isProfilePublic: false,
          deletedAt: new Date(),
        },
      });
      await this.sessions.revokeAll(taskerId, transaction);
    });
    return { deactivated: true };
  }

  private async requireTasker(taskerId: number) {
    const user = await this.prisma.user.findFirst({
      where: { id: taskerId, role: UserRole.Tasker, deletedAt: null },
    });
    if (!user) throw new NotFoundException('Tasker account not found');
    return user;
  }

  private personalView(user: {
    firstName: string | null;
    lastName: string | null;
    email: string;
    phoneCountryCode: string | null;
    phoneNumber: string | null;
    bio: string | null;
    profilePicture: string | null;
  }): TaskerPersonalProfileView {
    return {
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      email: user.email,
      phoneCountryCode: user.phoneCountryCode ?? '',
      phoneNumber: user.phoneNumber ?? '',
      bio: user.bio ?? '',
      profilePicture: user.profilePicture ?? '',
    };
  }

  private businessView(
    user: {
      yearsOfExperience: number | null;
      isProfilePublic: boolean;
      serviceAreaLabel: string | null;
      serviceAreaLat: unknown;
      serviceAreaLng: unknown;
      serviceAreaRadiusKm: unknown;
      serviceAreaCity: string | null;
      serviceAreaArea: string | null;
    },
    skills: TaskerSkillView[],
  ): TaskerBusinessProfileView {
    return {
      yearsOfExperience: user.yearsOfExperience,
      isProfilePublic: user.isProfilePublic,
      serviceArea: {
        label: user.serviceAreaLabel,
        lat: user.serviceAreaLat === null ? null : Number(user.serviceAreaLat),
        lng: user.serviceAreaLng === null ? null : Number(user.serviceAreaLng),
        radiusKm: user.serviceAreaRadiusKm === null ? null : Number(user.serviceAreaRadiusKm),
        city: user.serviceAreaCity,
        area: user.serviceAreaArea,
      },
      skills,
    };
  }

  private async syncTaskerSkillSnapshot(
    taskerId: number,
    transaction: Prisma.TransactionClient,
  ): Promise<void> {
    const selected = await transaction.userService.findMany({
      where: { userId: taskerId },
      include: { service: { select: { slug: true } } },
      orderBy: { hourlyRate: 'asc' },
    });
    await transaction.user.update({
      where: { id: taskerId },
      data: {
        skills: selected
          .map((row) => row.service.slug)
          .filter((slug): slug is string => Boolean(slug)),
        hourlyRate: selected[0]?.hourlyRate ?? null,
      },
    });
  }
}
