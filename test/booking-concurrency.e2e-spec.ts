import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UserRole } from '../src/common/enums/user-role.enum';
import type { AccessTokenPayload } from '../src/common/types/jwt-payload';
import { dateOnlyFromDate, dateOnlyToDate } from '../src/common/utils/date.util';
import { PrismaService } from '../src/database/prisma.service';
import type {
  Service,
  User,
  UserAvailability,
} from '../src/generated/prisma/client';

const futureDate = (daysFromNow: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
};

describe('Booking slot concurrency (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwt: JwtService;
  let customer: User;
  let tasker: User;
  let service: Service;
  let availability: UserAvailability;
  const unique = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let jwtSecret: string;
  let sessionId: number;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'Booking concurrency e2e test requires a migrated PostgreSQL test database',
      );
    }

    jwtSecret = process.env.JWT_SECRET ?? '';
    if (!jwtSecret) {
      throw new Error('Booking concurrency e2e test requires JWT_SECRET');
    }

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = app.get(PrismaService);
    jwt = app.get(JwtService);

    customer = await prisma.user.create({
      data: {
        email: `customer-${unique}@example.com`,
        firstName: 'Concurrency',
        lastName: 'Customer',
        role: UserRole.Customer,
        authType: '',
        isVerified: true,
      },
    });
    const session = await prisma.refreshToken.create({
      data: {
        userId: customer.id,
        tokenHash: `concurrency-${unique}`,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    sessionId = session.id;
    tasker = await prisma.user.create({
      data: {
        email: `tasker-${unique}@example.com`,
        firstName: 'Concurrency',
        lastName: 'Tasker',
        role: UserRole.Tasker,
        authType: '',
        isVerified: true,
        onboardingStatus: 'approved',
      },
    });
    const now = new Date();
    service = await prisma.service.create({
      data: {
        name: `Concurrency Service ${unique}`,
        description: 'Concurrency test service',
        slug: `concurrency-service-${unique}`,
        icon: 'Test',
        createdAt: now,
        updatedAt: now,
      },
    });
    await prisma.userService.create({
      data: {
        userId: tasker.id,
        serviceId: service.id,
        hourlyRate: '125.00',
      },
    });
    availability = await prisma.userAvailability.create({
      data: {
        userId: tasker.id,
        date: dateOnlyToDate(futureDate(2)),
        startTime: '10:00',
        endTime: '11:00',
      },
    });
  });

  afterAll(async () => {
    if (prisma) {
      if (availability) {
        await prisma.booking.deleteMany({ where: { availabilityId: availability.id } });
        await prisma.userAvailability.deleteMany({ where: { id: availability.id } });
      }
      if (tasker) await prisma.userService.deleteMany({ where: { userId: tasker.id } });
      const userIds = [customer?.id, tasker?.id].filter(
        (value): value is number => typeof value === 'number',
      );
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      if (service) await prisma.service.deleteMany({ where: { id: service.id } });
    }
    if (app) await app.close();
  });

  it('allows only one booking to claim the same slot', async () => {
    const payload: AccessTokenPayload = {
      sub: customer.id,
      id: customer.id,
      isVerified: true,
      isAdmin: false,
      role: UserRole.Customer,
      permissions: [],
      sessionId,
    };
    const accessToken = await jwt.signAsync(payload, {
      secret: jwtSecret,
      expiresIn: '5m',
    });

    const body = {
      taskerId: tasker.id,
      serviceSlug: service.slug,
      paymentSource: 'wallet',
      location: {
        label: 'Test venue',
        lat: 33.5731,
        lng: -7.5898,
        city: 'Casablanca',
      },
      date: dateOnlyFromDate(availability.date),
      time: availability.startTime,
      bookingDetails: {
        venueAddress: '1 Test Street',
        description: 'Verify atomic slot claiming',
      },
    };

    const responses = await Promise.all([
      request(app.getHttpServer())
        .post('/api/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body),
      request(app.getHttpServer())
        .post('/api/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(
      await prisma.booking.count({ where: { availabilityId: availability.id } }),
    ).toBe(1);
    const storedSlot = await prisma.userAvailability.findUnique({
      where: { id: availability.id },
    });
    expect(storedSlot?.isBooked).toBe(true);
  });
});
