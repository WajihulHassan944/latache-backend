import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RequestLocale } from '../localization/request-locale.decorator';
import { SubmitEnquiryDto } from './contact.dto';
import { ContactService } from './contact.service';

@ApiTags('67 Contact (public)')
@Controller('contact')
export class ContactPublicController {
  constructor(private readonly contact: ContactService) {}

  @Post('enquiries')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @ApiOperation({
    summary: 'Send a message through the public Contact form',
    description:
      'Public, rate-limited (5/hour/IP), Turnstile-protected, honeypot-guarded. Creates an enquiry in the admin Inbox, notifies admins and emails the sender an acknowledgement with a reference.',
  })
  submit(@Body() dto: SubmitEnquiryDto, @Req() request: Request, @RequestLocale() locale: string) {
    return this.contact.submit(dto, { ip: request.ip, locale });
  }
}
