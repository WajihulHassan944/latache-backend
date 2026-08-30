import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { UserRole } from '../../common/enums/user-role.enum';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, type User } from '../../generated/prisma/client';
import { AdminAuditService } from '../admin-audit/admin-audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeOutboxService } from '../realtime/realtime-outbox.service';
import { TASK_TIMER_STATUS } from '../tasker-dashboard/tasker-dashboard.constants';
import { UploadsService } from '../uploads/uploads.service';
import type { WorkOtpDto, WorkProofDto } from './dto/work-verification.dto';

const FRONT_DOOR = 'front_door';
const COMPLETION = 'completion';

type InvalidOtpResult = { invalid: true; attempts: number; locked: boolean };
type ValidOtpResult<T> = { invalid: false; value: T };

@Injectable()
export class BookingWorkVerificationService {
  private readonly otpSecret: string;
  private readonly otpTtlMinutes: number;
  private readonly otpMaxAttempts: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly uploads: UploadsService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeOutboxService,
    private readonly audit: AdminAuditService,
  ) {
    this.otpSecret = config.getOrThrow<string>('auth.otpHashSecret');
    this.otpTtlMinutes = config.get<number>('bookingWorkVerification.otpTtlMinutes', 15);
    this.otpMaxAttempts = config.get<number>('bookingWorkVerification.otpMaxAttempts', 5);
  }

  async state(user: User, bookingId: number) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { workProofs: { orderBy: { createdAt: 'asc' } }, workSession: true },
    });
    this.assertParticipant(user, booking);
    return this.serializeState(booking!);
  }

  async attachFrontDoor(user: User, bookingId: number, dto: WorkProofDto) {
    if (user.role !== UserRole.Tasker) throw new ForbiddenException('Only the Tasker can attach the front-door proof');
    const verified = await this.uploads.verifyBookingWorkImage(user, dto);
    await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockBooking(bookingId, transaction);
      if (booking.taskerId !== user.id) throw new NotFoundException('Booking not found');
      if (!booking.workVerificationRequired) {
        throw new ConflictException('This booking uses the legacy work flow and does not require a front-door proof');
      }
      if (booking.status !== 'arrived') throw new ConflictException('Front-door proof can be attached only after arrival');
      const existing = await transaction.bookingWorkProof.findUnique({
        where: { bookingId_kind: { bookingId, kind: FRONT_DOOR } },
      });
      if (existing) {
        if (existing.publicId === verified.publicId) return;
        throw new ConflictException('Front-door proof is immutable once submitted');
      }
      const now = new Date();
      await transaction.bookingWorkProof.create({
        data: {
          bookingId,
          taskerId: user.id,
          kind: FRONT_DOOR,
          publicId: verified.publicId,
          secureUrl: verified.secureUrl,
          resourceType: verified.resourceType,
          bytes: verified.bytes,
          mimeType: verified.mimeType,
          capturedAt: now,
        },
      });
      await transaction.booking.update({ where: { id: bookingId }, data: { frontDoorVerifiedAt: now } });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'front_door_proof_submitted',
          title: 'Arrival proof submitted',
          body: 'Your Tasker attached the front-door arrival proof. You can now generate the start code.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.enqueue(bookingId, booking.status, 'front_door_proof_submitted', transaction);
    });
    return this.state(user, bookingId);
  }

  async issueStartCode(customerId: number, bookingId: number) {
    const code = this.generateOtp();
    const expiresAt = new Date(Date.now() + this.otpTtlMinutes * 60_000);
    await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockBooking(bookingId, transaction);
      if (booking.customerId !== customerId) throw new NotFoundException('Booking not found');
      if (!booking.workVerificationRequired) throw new ConflictException('This booking does not require a start code');
      if (booking.status !== 'arrived') throw new ConflictException('Start code can be generated only after Tasker arrival');
      if (!booking.frontDoorVerifiedAt) throw new ConflictException('Front-door proof is required before generating the start code');
      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          startWorkOtpHash: this.hashOtp('start', bookingId, code),
          startWorkOtpExpiresAt: expiresAt,
          startWorkOtpAttempts: 0,
        },
      });
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks',
          type: 'work_start_code_ready',
          title: 'Customer generated the work start code',
          body: 'Ask the Customer for the six-digit code to start the task timer.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
    });
    return { bookingId: String(bookingId), code, expiresAt: expiresAt.toISOString() };
  }

  async startWork(taskerId: number, bookingId: number, dto: WorkOtpDto) {
    const result = await this.prisma.$transaction<InvalidOtpResult | ValidOtpResult<unknown>>(async (transaction) => {
      const booking = await this.lockBooking(bookingId, transaction);
      if (booking.taskerId !== taskerId) throw new NotFoundException('Booking not found');
      if (!booking.workVerificationRequired) throw new ConflictException('Use the legacy timer-start endpoint for this booking');
      if (booking.status !== 'arrived') throw new ConflictException('Work can start only after arrival');
      if (!booking.frontDoorVerifiedAt) throw new ConflictException('Front-door proof is required before work starts');
      if (!booking.startWorkOtpHash || !booking.startWorkOtpExpiresAt) {
        throw new ConflictException('The Customer must generate a start code first');
      }
      if (booking.startWorkOtpExpiresAt.getTime() <= Date.now()) throw new BadRequestException('The work start code has expired');
      if (booking.startWorkOtpAttempts >= this.otpMaxAttempts) throw new ConflictException('Too many invalid start-code attempts; ask the Customer for a new code');
      if (!this.matchesOtp('start', bookingId, dto.code, booking.startWorkOtpHash)) {
        const attempts = booking.startWorkOtpAttempts + 1;
        await transaction.booking.update({ where: { id: bookingId }, data: { startWorkOtpAttempts: attempts } });
        return { invalid: true, attempts, locked: attempts >= this.otpMaxAttempts };
      }
      const existing = await transaction.taskWorkSession.findUnique({ where: { bookingId } });
      if (existing) throw new ConflictException('A task timer already exists for this booking');
      const now = new Date();
      const session = await transaction.taskWorkSession.create({
        data: { bookingId, taskerId, status: TASK_TIMER_STATUS.Running, startedAt: now },
      });
      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          status: 'in_progress',
          taskStartedAt: now,
          startWorkVerifiedAt: now,
          startWorkOtpHash: null,
          startWorkOtpExpiresAt: null,
          startWorkOtpAttempts: 0,
        },
      });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'task_started',
          title: 'Task started',
          body: 'The start code was verified and the Tasker timer is now running.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.audit.record(
        { actorId: taskerId, targetUserId: booking.customerId, action: 'booking_work_start_verified', entityType: 'booking', entityId: bookingId },
        transaction,
      );
      await this.enqueue(bookingId, 'in_progress', 'work_start_otp_verified', transaction);
      await this.realtime.enqueueBooking(
        bookingId,
        'booking:timer',
        {
          bookingId: String(bookingId),
          status: session.status,
          startedAt: session.startedAt.toISOString(),
          pausedAt: null,
          stoppedAt: null,
          accumulatedPausedSecs: 0,
        },
        transaction,
      );
      return { invalid: false, value: session };
    });
    if (result.invalid) {
      throw new BadRequestException({
        code: result.locked ? 'WORK_START_OTP_ATTEMPTS_EXHAUSTED' : 'WORK_START_OTP_INVALID',
        message: result.locked ? 'Too many invalid attempts; ask the Customer for a new start code' : 'Invalid work start code',
        attempts: result.attempts,
      });
    }
    return { bookingId: String(bookingId), started: true, verification: await this.stateForUserId(taskerId, UserRole.Tasker, bookingId) };
  }

  async attachCompletion(user: User, bookingId: number, dto: WorkProofDto) {
    if (user.role !== UserRole.Tasker) throw new ForbiddenException('Only the Tasker can attach completed-work proof');
    const verified = await this.uploads.verifyBookingWorkImage(user, dto);
    await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockBooking(bookingId, transaction);
      if (booking.taskerId !== user.id) throw new NotFoundException('Booking not found');
      if (!booking.workVerificationRequired) throw new ConflictException('This booking uses the legacy completion flow');
      if (booking.status !== 'in_progress') throw new ConflictException('Completed-work proof can be submitted only while work is in progress');
      const existingProof = await transaction.bookingWorkProof.findUnique({
        where: { bookingId_kind: { bookingId, kind: COMPLETION } },
      });
      if (existingProof) {
        if (existingProof.publicId === verified.publicId) return;
        throw new ConflictException('Completed-work proof is immutable once submitted');
      }
      const session = await transaction.taskWorkSession.findUnique({ where: { bookingId } });
      if (!session || ![TASK_TIMER_STATUS.Running, TASK_TIMER_STATUS.Paused].includes(session.status as never)) {
        throw new ConflictException('An active task timer is required before submitting completed-work proof');
      }
      const now = new Date();
      const pausedDelta = session.status === TASK_TIMER_STATUS.Paused && session.pausedAt
        ? Math.max(0, Math.floor((now.getTime() - session.pausedAt.getTime()) / 1000))
        : 0;
      await transaction.taskWorkSession.update({
        where: { bookingId },
        data: {
          status: TASK_TIMER_STATUS.Stopped,
          pausedAt: null,
          stoppedAt: now,
          accumulatedPausedSecs: { increment: pausedDelta },
        },
      });
      await transaction.bookingWorkProof.create({
        data: {
          bookingId,
          taskerId: user.id,
          kind: COMPLETION,
          publicId: verified.publicId,
          secureUrl: verified.secureUrl,
          resourceType: verified.resourceType,
          bytes: verified.bytes,
          mimeType: verified.mimeType,
          capturedAt: now,
        },
      });
      await transaction.booking.update({ where: { id: bookingId }, data: { completionProofAt: now } });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks',
          type: 'work_completion_proof_submitted',
          title: 'Work completion proof submitted',
          body: 'The Tasker attached the completed-work photo. The billable timer has stopped; generate the completion code after checking the work.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
      await this.enqueue(bookingId, booking.status, 'completion_proof_submitted', transaction);
    });
    return this.state(user, bookingId);
  }

  async issueCompletionCode(customerId: number, bookingId: number) {
    const code = this.generateOtp();
    const expiresAt = new Date(Date.now() + this.otpTtlMinutes * 60_000);
    await this.prisma.$transaction(async (transaction) => {
      const booking = await this.lockBooking(bookingId, transaction);
      if (booking.customerId !== customerId) throw new NotFoundException('Booking not found');
      if (!booking.workVerificationRequired) throw new ConflictException('This booking does not require a completion code');
      if (booking.status !== 'in_progress') throw new ConflictException('Completion code can be generated only for active work');
      if (!booking.completionProofAt) throw new ConflictException('The Tasker must attach completed-work proof first');
      const session = await transaction.taskWorkSession.findUnique({ where: { bookingId } });
      if (!session?.stoppedAt) throw new ConflictException('The billable timer must be stopped before completion verification');
      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          completionOtpHash: this.hashOtp('completion', bookingId, code),
          completionOtpExpiresAt: expiresAt,
          completionOtpAttempts: 0,
        },
      });
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks',
          type: 'work_completion_code_ready',
          title: 'Customer generated the completion code',
          body: 'Ask the Customer for the six-digit completion code to finish the task.',
          entityType: 'booking',
          entityId: String(bookingId),
        },
        transaction,
      );
    });
    return { bookingId: String(bookingId), code, expiresAt: expiresAt.toISOString() };
  }

  async finishWork(taskerId: number, bookingId: number, dto: WorkOtpDto) {
    const result = await this.prisma.$transaction<InvalidOtpResult | ValidOtpResult<true>>(async (transaction) => {
      const booking = await this.lockBooking(bookingId, transaction);
      if (booking.taskerId !== taskerId) throw new NotFoundException('Booking not found');
      if (!booking.workVerificationRequired) throw new ConflictException('Use the legacy completion endpoint for this booking');
      if (booking.status === 'completed' && booking.completionVerifiedAt) return { invalid: false, value: true };
      if (booking.status !== 'in_progress') throw new ConflictException('Only an in-progress task can be finished');
      if (!booking.completionProofAt) throw new ConflictException('Completed-work proof is required before finishing the task');
      const session = await transaction.taskWorkSession.findUnique({ where: { bookingId } });
      if (!session?.stoppedAt || session.status !== TASK_TIMER_STATUS.Stopped) {
        throw new ConflictException('Completed-work proof must freeze the task timer before finishing');
      }
      if (!booking.completionOtpHash || !booking.completionOtpExpiresAt) throw new ConflictException('The Customer must generate a completion code first');
      if (booking.completionOtpExpiresAt.getTime() <= Date.now()) throw new BadRequestException('The completion code has expired');
      if (booking.completionOtpAttempts >= this.otpMaxAttempts) throw new ConflictException('Too many invalid completion-code attempts; ask the Customer for a new code');
      if (!this.matchesOtp('completion', bookingId, dto.code, booking.completionOtpHash)) {
        const attempts = booking.completionOtpAttempts + 1;
        await transaction.booking.update({ where: { id: bookingId }, data: { completionOtpAttempts: attempts } });
        return { invalid: true, attempts, locked: attempts >= this.otpMaxAttempts };
      }
      const now = new Date();
      await transaction.booking.update({
        where: { id: bookingId },
        data: {
          status: 'completed',
          completionSubmittedAt: booking.completionProofAt,
          completionApprovedAt: now,
          completionApprovedByRole: 'customer_otp',
          completionVerifiedAt: now,
          completionVerifiedByRole: 'customer_otp',
          taskCompletedAt: now,
          completionOtpHash: null,
          completionOtpExpiresAt: null,
          completionOtpAttempts: 0,
        },
      });
      await transaction.user.update({ where: { id: booking.taskerId }, data: { completedTasks: { increment: 1 } } });
      await this.notifications.create(
        booking.customerId,
        {
          category: 'tasks', type: 'task_completed', title: 'Task completed',
          body: 'The completion code was verified and final payment processing can now begin.',
          entityType: 'booking', entityId: String(bookingId),
        }, transaction,
      );
      await this.notifications.create(
        booking.taskerId,
        {
          category: 'tasks', type: 'task_completion_verified', title: 'Completion verified',
          body: 'The Customer completion code was verified. Final payment processing can now begin.',
          entityType: 'booking', entityId: String(bookingId),
        }, transaction,
      );
      await this.audit.record(
        { actorId: taskerId, targetUserId: booking.customerId, action: 'booking_completion_otp_verified', entityType: 'booking', entityId: bookingId },
        transaction,
      );
      await this.enqueue(bookingId, 'completed', 'completion_otp_verified', transaction);
      return { invalid: false, value: true };
    });
    if (result.invalid) {
      throw new BadRequestException({
        code: result.locked ? 'WORK_COMPLETION_OTP_ATTEMPTS_EXHAUSTED' : 'WORK_COMPLETION_OTP_INVALID',
        message: result.locked ? 'Too many invalid attempts; ask the Customer for a new completion code' : 'Invalid completion code',
        attempts: result.attempts,
      });
    }
    return { bookingId: String(bookingId), completed: true };
  }

  private async stateForUserId(userId: number, role: UserRole.Customer | UserRole.Tasker, bookingId: number) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.state({ ...user, role } as User, bookingId);
  }

  private serializeState(booking: any) {
    const proof = (kind: string) => booking.workProofs?.find((item: any) => item.kind === kind) ?? null;
    const frontDoor = proof(FRONT_DOOR);
    const completion = proof(COMPLETION);
    return {
      bookingId: String(booking.id),
      required: booking.workVerificationRequired,
      status: booking.status,
      frontDoor: frontDoor ? this.proofView(frontDoor) : null,
      frontDoorVerifiedAt: booking.frontDoorVerifiedAt?.toISOString() ?? null,
      startVerifiedAt: booking.startWorkVerifiedAt?.toISOString() ?? null,
      startCodePending: Boolean(booking.startWorkOtpHash && booking.startWorkOtpExpiresAt),
      completionProof: completion ? this.proofView(completion) : null,
      completionProofAt: booking.completionProofAt?.toISOString() ?? null,
      completionCodePending: Boolean(booking.completionOtpHash && booking.completionOtpExpiresAt),
      completionVerifiedAt: booking.completionVerifiedAt?.toISOString() ?? null,
      completionVerifiedByRole: booking.completionVerifiedByRole ?? null,
      timer: booking.workSession ? {
        status: booking.workSession.status,
        startedAt: booking.workSession.startedAt.toISOString(),
        stoppedAt: booking.workSession.stoppedAt?.toISOString() ?? null,
      } : null,
    };
  }

  private proofView(row: any) {
    return {
      id: row.id,
      kind: row.kind,
      publicId: row.publicId,
      secureUrl: row.secureUrl,
      mimeType: row.mimeType,
      bytes: row.bytes,
      capturedAt: row.capturedAt.toISOString(),
    };
  }

  private assertParticipant(user: User, booking: any): void {
    if (!booking) throw new NotFoundException('Booking not found');
    const allowed = user.role === UserRole.Customer
      ? booking.customerId === user.id
      : user.role === UserRole.Tasker
        ? booking.taskerId === user.id
        : false;
    if (!allowed) throw new NotFoundException('Booking not found');
  }

  private async lockBooking(bookingId: number, transaction: Prisma.TransactionClient) {
    await transaction.$queryRaw`SELECT "id" FROM "Bookings" WHERE "id" = ${bookingId} FOR UPDATE`;
    const booking = await transaction.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  private generateOtp(): string {
    return String(randomInt(100000, 1000000));
  }

  private hashOtp(purpose: 'start' | 'completion', bookingId: number, code: string): string {
    return createHmac('sha256', this.otpSecret)
      .update(`booking-work:${purpose}:${bookingId}:${code}`, 'utf8')
      .digest('hex');
  }

  private matchesOtp(purpose: 'start' | 'completion', bookingId: number, code: string, expectedHash: string): boolean {
    if (!/^[0-9]{6}$/.test(code) || !/^[a-f0-9]{64}$/i.test(expectedHash)) return false;
    const actual = Buffer.from(this.hashOtp(purpose, bookingId, code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private enqueue(bookingId: number, status: string, reason: string, transaction: Prisma.TransactionClient) {
    return this.realtime.enqueueBooking(
      bookingId,
      'booking:updated',
      { bookingId: String(bookingId), status, reason },
      transaction,
    );
  }
}
