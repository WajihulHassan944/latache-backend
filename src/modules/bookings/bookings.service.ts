import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '../../common/enums/user-role.enum';
import {
  dateOnlyFromDate,
  dateOnlyToDate,
  getDayTitle,
  isFutureDate,
} from '../../common/utils/date.util';
import { formatLocation } from '../../common/utils/location.util';
import { parseTimeToMinutes } from '../../common/utils/time.util';
import { hasPrismaErrorCode } from '../../database/prisma-error.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { BookingsRepository } from './bookings.repository';
import { BookTaskerDto } from './dto/book-tasker.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: BookingsRepository,
  ) {}

  async book(customerId: number, dto: BookTaskerDto) {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`
          SELECT "id" FROM "Users"
          WHERE "id" IN (${customerId}, ${dto.taskerId})
          ORDER BY "id"
          FOR UPDATE
        `;
        const customer = await transaction.user.findUnique({
          where: { id: customerId },
        });
        if (!customer) throw new NotFoundException('User not found');
        if (customer.role !== UserRole.Customer) {
          throw new ForbiddenException('Only customers can book taskers');
        }

        const tasker = await transaction.user.findFirst({
          where: { id: dto.taskerId, role: UserRole.Tasker },
        });
        if (!tasker?.onboardingStatus) throw new NotFoundException('Tasker not found');
        if (!isFutureDate(dto.date)) {
          throw new BadRequestException('date must be after today');
        }

        const service = await transaction.service.findFirst({
          where: { slug: dto.serviceSlug },
        });
        if (!service) {
          throw new BadRequestException(`Unknown service: ${dto.serviceSlug}`);
        }

        const taskerService = await this.repository.findTaskerServiceRate(
          tasker.id,
          service.id,
          transaction,
        );
        if (!taskerService) {
          throw new BadRequestException('Tasker does not offer this service');
        }

        const slots = await this.repository.findOpenSlotsForDate(
          tasker.id,
          dto.date,
          transaction,
        );
        const requestedMinutes = parseTimeToMinutes(dto.time);
        const matchedSlot = slots.find(
          (slot) => parseTimeToMinutes(slot.startTime) === requestedMinutes,
        );
        if (!matchedSlot || requestedMinutes === null) {
          throw new ConflictException(
            'Requested date/time is not an available slot for this tasker',
          );
        }
        if (!(await this.repository.claimSlot(matchedSlot.id, transaction))) {
          throw new ConflictException('Requested slot has already been booked');
        }

        const booking = await this.repository.create(
          {
            customerId,
            taskerId: tasker.id,
            serviceId: service.id,
            availabilityId: matchedSlot.id,
            hourlyRate: taskerService.hourlyRate,
            bookingDate: dateOnlyToDate(dto.date),
            startTime: matchedSlot.startTime,
            endTime: matchedSlot.endTime,
            venueAddress: dto.bookingDetails.venueAddress,
            apartmentSuite: dto.bookingDetails.apartmentSuite || null,
            description: dto.bookingDetails.description,
            attachments: dto.bookingDetails.attachments
              ? (dto.bookingDetails.attachments as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
            locationLabel: dto.location.label,
            locationLat: dto.location.lat,
            locationLng: dto.location.lng,
            locationCity: dto.location.city ?? null,
            locationArea: dto.location.area ?? null,
            status: 'pending',
          },
          transaction,
        );

        return {
          bookingId: booking.id.toString(),
          status: booking.status,
          taskerId: tasker.id.toString(),
          taskerName: `${tasker.firstName || ''} ${tasker.lastName || ''}`.trim(),
          serviceSlug: service.slug,
          pricePerHour: Number(taskerService.hourlyRate),
          date: dateOnlyFromDate(booking.bookingDate),
          startTime: booking.startTime,
          endTime: booking.endTime,
          location: formatLocation({
            label: booking.locationLabel,
            lat: Number(booking.locationLat),
            lng: Number(booking.locationLng),
            city: booking.locationCity,
            area: booking.locationArea,
          }),
          bookingDetails: {
            venueAddress: booking.venueAddress,
            apartmentSuite: booking.apartmentSuite,
            description: booking.description,
            attachments: Array.isArray(booking.attachments) ? booking.attachments : [],
          },
          createdAt: booking.createdAt.toISOString(),
        };
      });
    } catch (error) {
      if (hasPrismaErrorCode(error, 'P2002') || hasPrismaErrorCode(error, 'P2034')) {
        throw new ConflictException('Requested slot has already been booked');
      }
      throw error;
    }
  }

  getUpcoming(userId: number, query: ListBookingsQueryDto) {
    return this.repository.getUpcoming(userId, query);
  }

  getCompleted(userId: number, query: ListBookingsQueryDto) {
    return this.repository.getCompleted(userId, query);
  }

  async getNext(userId: number) {
    const booking = await this.repository.getNext(userId);
    if (!booking) throw new NotFoundException('No upcoming booking found');
    return { ...booking, dayTitle: getDayTitle(booking.date as string) };
  }
}
