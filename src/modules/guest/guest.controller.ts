import { Body, Controller, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UpdateLocationDto } from '../../common/dto/update-location.dto';
import { UserRole } from '../../common/enums/user-role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { User } from '../../generated/prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConvertGuestSessionDto } from './dto/convert-guest-session.dto';
import { CreateGuestTokenDto } from './dto/create-guest-token.dto';
import { GuestOnlyGuard } from './guards/guest-only.guard';
import type { GuestAwareRequest } from './guest-request';
import { GuestService, type GuestLocationResult, type GuestTokenResult } from './guest.service';

@ApiTags('02 Guest Sessions')
@Controller('guest')
export class GuestController {
  constructor(private readonly guests: GuestService) {}

  @Post('token')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Create an anonymous guest browsing session',
    description:
      'Public endpoint; never requires or accepts Customer/Tasker/Admin credentials. Issues a random opaque token tied to a new GuestSession row and returns the raw token only in this response - only its SHA-256 hash is ever persisted. Send the returned token as `Authorization: Bearer <token>` on the read-only public endpoints that require it (currently Tasker discovery and Services). The session expires after guest.tokenExpiresInHours (24h by default); expiresAt/status are always server-computed and cannot be requested by the client.',
  })
  @ApiCreatedResponse({
    description: 'Guest session created.',
    schema: {
      example: {
        guestId: 'guest_5f3d9a2b1c4e0f6a8b7d2c1e',
        token: '9e1c2f5a7b3d4e6f8091a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f70819a2b3c4d5e6f7',
        expiresAt: '2026-09-10T12:00:00.000Z',
      },
    },
  })
  async createToken(
    @Body() dto: CreateGuestTokenDto,
    @Req() request: Request,
  ): Promise<GuestTokenResult> {
    const userAgent = request.headers['user-agent'];
    return this.guests.createSession(dto, {
      ipAddress: request.ip,
      userAgent: Array.isArray(userAgent) ? userAgent.join(', ') : userAgent,
    });
  }

  @Post('convert')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.Customer, UserRole.Tasker)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Link a prior guest session to the now-authenticated account',
    description:
      'Requires a verified Customer/Tasker bearer session. Call this after signup/login when the client held a guest token during anonymous browsing, so guest activity can later be attributed to the real account. The linked account is always the authenticated caller; a guest session can never be claimed on behalf of someone else. Linking also revokes the guest token, so it can no longer be used for anonymous browsing afterward. Ordinary guest browsing never triggers this automatically.',
  })
  @ApiOkResponse({
    description: 'Guest session linked to the authenticated account (or already linked to it).',
    schema: { example: { guestId: 'guest_5f3d9a2b1c4e0f6a8b7d2c1e', linked: true } },
  })
  @ApiNotFoundResponse({ description: 'No guest session matches the supplied token.' })
  @ApiForbiddenResponse({ description: 'The guest session is expired or otherwise no longer active.' })
  @ApiConflictResponse({ description: 'The guest session is already linked to a different account.' })
  @ApiUnauthorizedResponse({ description: 'Bearer token or active session is missing or invalid.' })
  convert(
    @CurrentUser() user: User,
    @Body() dto: ConvertGuestSessionDto,
  ): Promise<{ guestId: string; linked: boolean }> {
    return this.guests.convert(dto.guestToken, user.id);
  }

  @Patch('location')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('bearer')
  @UseGuards(GuestOnlyGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: "Save the guest session's selected location",
    description:
      'Requires a guest token from POST /guest/token, sent as Authorization: Bearer <token> (a normal Customer/Tasker/Admin bearer session is never accepted here). Persists latitude/longitude on this guest session so GET /api/taskers falls back to it whenever a request omits lat/lng. Only this explicit call changes the saved location - lat/lng sent directly to GET /api/taskers are used for that one request only and never overwrite it.',
  })
  @ApiOkResponse({
    description: 'Location saved.',
    schema: {
      example: {
        guestId: 'guest_5f3d9a2b1c4e0f6a8b7d2c1e',
        latitude: 33.5731,
        longitude: -7.5898,
        locationUpdatedAt: '2026-09-04T10:00:00.000Z',
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Guest token is missing, invalid, expired, or revoked.' })
  updateLocation(
    @Req() request: GuestAwareRequest,
    @Body() dto: UpdateLocationDto,
  ): Promise<GuestLocationResult> {
    return this.guests.updateLocation((request.guest as NonNullable<typeof request.guest>).id, dto);
  }
}
