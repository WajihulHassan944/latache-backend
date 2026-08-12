import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { realtimeRoom } from './realtime.constants';

@Injectable()
export class RealtimeOutboxService {
  constructor(private readonly prisma: PrismaService) {}

  enqueue(
    room: string,
    eventName: string,
    payload: Prisma.InputJsonValue,
    transaction?: Prisma.TransactionClient,
  ) {
    return (transaction ?? this.prisma).realtimeOutboxEvent.create({
      data: { room, eventName, payload },
    });
  }

  enqueueUser(
    userId: number,
    eventName: string,
    payload: Prisma.InputJsonValue,
    transaction?: Prisma.TransactionClient,
  ) {
    return this.enqueue(realtimeRoom.user(userId), eventName, payload, transaction);
  }

  enqueueBooking(
    bookingId: number,
    eventName: string,
    payload: Prisma.InputJsonValue,
    transaction?: Prisma.TransactionClient,
  ) {
    return this.enqueue(realtimeRoom.booking(bookingId), eventName, payload, transaction);
  }

  enqueueConversation(
    bookingId: number,
    eventName: string,
    payload: Prisma.InputJsonValue,
    transaction?: Prisma.TransactionClient,
  ) {
    return this.enqueue(realtimeRoom.conversation(bookingId), eventName, payload, transaction);
  }

  enqueueSupportPublic(
    ticketId: number,
    eventName: string,
    payload: Prisma.InputJsonValue,
    transaction?: Prisma.TransactionClient,
  ) {
    return this.enqueue(realtimeRoom.supportPublic(ticketId), eventName, payload, transaction);
  }

  enqueueSupportAdmins(
    ticketId: number,
    eventName: string,
    payload: Prisma.InputJsonValue,
    transaction?: Prisma.TransactionClient,
  ) {
    return this.enqueue(realtimeRoom.supportAdmins(ticketId), eventName, payload, transaction);
  }
}
