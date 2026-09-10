import { Body, Controller, Post } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CreateAppealDto } from './dto/support.dto';
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
      'For Customer/Tasker accounts that cannot log in because their profile is suspended or deactivated (login is blocked before a session is issued). Verifies email/password, confirms the account is actually suspended or deactivated, then opens a category=appeal support ticket on the account\'s behalf.',
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
  createAppeal(@Body() dto: CreateAppealDto): Promise<unknown> {
    return this.support.createAppeal(dto);
  }
}
