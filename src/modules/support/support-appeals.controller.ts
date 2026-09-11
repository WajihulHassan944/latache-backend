import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AppealStatusCheckDto, CreateAppealDto } from './dto/support.dto';
import { SupportService } from './support.service';

@ApiTags('17 Support')
@Controller('support/appeals')
export class SupportAppealsController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit a suspension/deactivation appeal without an active session',
    description:
      'For Customer/Tasker accounts that cannot log in because their profile is suspended or deactivated (login is blocked before a session is issued). Verifies email/password, confirms the account is actually suspended or deactivated, then opens a category=appeal support ticket on the account\'s behalf. Rejected with 409 APPEAL_ALREADY_OPEN if the account already has an unresolved appeal ticket.',
  })
  @ApiBody({
    type: CreateAppealDto,
    examples: {
      taskerAppeal: {
        summary: 'Suspended tasker appeal',
        value: {
          email: 'tasker@example.com',
          password: 'CurrentPassword123!',
          message:
            'I was suspended after a customer complaint, but I believe this was a misunderstanding. Please review my case.',
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Email/password did not match an existing account.' })
  @ApiConflictResponse({
    description:
      'Account is not suspended/deactivated, or an appeal is already open (code: APPEAL_ALREADY_OPEN).',
  })
  createAppeal(@Body() dto: CreateAppealDto): Promise<unknown> {
    return this.support.createAppeal(dto);
  }

  @Post('status')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Check the status of a previously filed suspension/deactivation appeal',
    description:
      'Same mini-login identity-proof pattern as POST /support/appeals, so a still-suspended account that cannot log in can check what happened to its appeal. Returns the most recent category=appeal ticket for the account.',
  })
  @ApiBody({
    type: AppealStatusCheckDto,
    examples: {
      taskerAppealStatus: {
        summary: 'Check appeal status',
        value: { email: 'tasker@example.com', password: 'CurrentPassword123!' },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Email/password did not match an existing account.' })
  @ApiNotFoundResponse({ description: 'No appeal ticket exists for this account.' })
  appealStatus(@Body() dto: AppealStatusCheckDto): Promise<unknown> {
    return this.support.appealStatus(dto);
  }
}
