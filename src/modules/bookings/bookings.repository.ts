import { Injectable } from '@nestjs/common';
import {
  dateOnlyFromDate,
  dateOnlyToDate,
  todayDateOnly,
} from '../../common/utils/date.util';
import { formatLocation } from '../../common/utils/location.util';
import { normalizePagination } from '../../common/utils/pagination.util';
import { parseTimeToMinutes } from '../../common/utils/time.util';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type UserAvailability, type UserService } from '../../generated/prisma/client';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

type BookingWithRelations = Prisma.BookingGetPayload<{
  include: {
    service: true;
    customer: {
      select: { id: true; firstName: true; lastName: true; profilePicture: true };
    };
    tasker: {
      select: { id: true; firstName: true; lastName: true; profilePicture: true };
    };
  };
}>;

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

  async claimSlot(
    availabilityId: number,
    transaction: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await transaction.userAvailability.updateMany({
      where: { id: availabilityId, isBooked: false },
      data: { isBooked: true },
    });
    return result.count === 1;
  }

  create(
    data: Prisma.BookingUncheckedCreateInput,
    transaction: Prisma.TransactionClient,
  ) {
    return transaction.booking.create({ data });
  }

  getUpcoming(userId: number, query: ListBookingsQueryDto) {
    return this.getViewerBookings(userId, 'upcoming', query, 'asc');
  }

  getCompleted(userId: number, query: ListBookingsQueryDto) {
    return this.getViewerBookings(userId, 'completed', query, 'desc');
  }

  async getNext(userId: number) {
    const bookings = await this.findViewerBookings(userId, 'upcoming');
    if (!bookings.length) return null;
    bookings.sort((left, right) => this.compareBookings(left, right, 'asc'));
    return this.serialize(bookings[0] as BookingWithRelations, userId);
  }

  private async getViewerBookings(
    userId: number,
    type: 'upcoming' | 'completed',
    query: ListBookingsQueryDto,
    direction: 'asc' | 'desc',
  ) {
    const { page, limit, offset } = normalizePagination(query.page, query.limit, 10);
    const bookings = await this.findViewerBookings(userId, type);
    bookings.sort((left, right) => this.compareBookings(left, right, direction));
    const totalItems = bookings.length;
    return {
      items: bookings
        .slice(offset, offset + limit)
        .map((booking) => this.serialize(booking, userId)),
      page,
      limit,
      totalItems,
      totalPages: Math.ceil(totalItems / limit),
    };
  }

  private findViewerBookings(
    userId: number,
    type: 'upcoming' | 'completed',
  ): Promise<BookingWithRelations[]> {
    const today = dateOnlyToDate(todayDateOnly());
    return this.prisma.booking.findMany({
      where: {
        OR: [{ customerId: userId }, { taskerId: userId }],
        bookingDate: type === 'upcoming' ? { gte: today } : { lt: today },
      },
      include: {
        service: true,
        customer: {
          select: { id: true, firstName: true, lastName: true, profilePicture: true },
        },
        tasker: {
          select: { id: true, firstName: true, lastName: true, profilePicture: true },
        },
      },
    });
  }

  private compareBookings(
    left: BookingWithRelations,
    right: BookingWithRelations,
    direction: 'asc' | 'desc',
  ): number {
    const multiplier = direction === 'asc' ? 1 : -1;
    const leftDate = left.bookingDate.getTime();
    const rightDate = right.bookingDate.getTime();
    if (leftDate !== rightDate) return (leftDate - rightDate) * multiplier;
    const leftMinutes = parseTimeToMinutes(left.startTime) ?? 0;
    const rightMinutes = parseTimeToMinutes(right.startTime) ?? 0;
    return (leftMinutes - rightMinutes) * multiplier;
  }

  private serialize(booking: BookingWithRelations, viewerId: number) {
    const isCustomer = booking.customerId === viewerId;
    const otherParty = isCustomer ? booking.tasker : booking.customer;
    const attachments = Array.isArray(booking.attachments) ? booking.attachments : [];

    return {
      id: booking.id.toString(),
      status: booking.status,
      viewerRole: isCustomer ? 'customer' : 'tasker',
      service: {
        id: booking.service.id.toString(),
        slug: booking.service.slug,
        name: booking.service.name,
        icon: booking.service.icon ?? '',
      },
      [isCustomer ? 'tasker' : 'customer']: {
        id: otherParty.id.toString(),
        name: `${otherParty.firstName || ''} ${otherParty.lastName || ''}`.trim(),
        avatar: otherParty.profilePicture || '',
      },
      pricePerHour: Number(booking.hourlyRate),
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
        attachments,
      },
      createdAt: booking.createdAt.toISOString(),
    };
  }
}
