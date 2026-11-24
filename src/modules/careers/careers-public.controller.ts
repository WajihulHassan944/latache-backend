import { Body, Controller, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { RequestLocale } from '../localization/request-locale.decorator';
import { ApplyDto, PublicJobsQueryDto } from './careers.dto';
import { CV_MAX_BYTES, CareersService, type CvFile } from './careers.service';

@ApiTags('64 Careers (public)')
@Controller('careers')
export class CareersPublicController {
  constructor(private readonly careers: CareersService) {}

  @Get('jobs')
  @ApiOperation({
    summary: 'Open roles with search, filters, facets and headline stats',
    description: 'Public. Only open roles are listed. facets carry counts for building the filter UI; stats feeds the hero strip.',
  })
  list(@Query() query: PublicJobsQueryDto) {
    return this.careers.listPublic(query);
  }

  @Get('jobs/:slug')
  @ApiParam({ name: 'slug', type: String })
  @ApiOperation({
    summary: 'One role (open or closed) with similar open roles',
    description: 'Closed roles still resolve with accepting=false so shared links show a "this role has been filled" state. Drafts are 404.',
  })
  detail(@Param('slug') slug: string) {
    return this.careers.getPublic(slug);
  }

  @Post('applications')
  @Throttle({ default: { limit: 5, ttl: 3_600_000 } })
  @UseInterceptors(FileInterceptor('cv', { limits: { fileSize: CV_MAX_BYTES, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['fullName', 'email', 'phone', 'city', 'coverNote', 'consent', 'cv'],
      properties: {
        jobSlug: { type: 'string', description: 'Omit for a general application' },
        fullName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        city: { type: 'string' },
        linkedinUrl: { type: 'string' },
        portfolioUrl: { type: 'string' },
        coverNote: { type: 'string' },
        source: { type: 'string' },
        consent: { type: 'string', example: 'true' },
        captchaToken: { type: 'string' },
        cv: { type: 'string', format: 'binary', description: 'PDF, DOC or DOCX, max 5 MB' },
      },
    },
  })
  @ApiOperation({
    summary: 'Apply to a role (or send a general application)',
    description:
      'Public, rate-limited (5/hour/IP), Turnstile-protected. The CV is verified by content (not just extension) and stored as a private asset. 409 ALREADY_APPLIED for the same email + role within 30 days. Sends a localized confirmation email.',
  })
  apply(
    @Body() dto: ApplyDto,
    @UploadedFile() file: CvFile | undefined,
    @Req() request: Request,
    @RequestLocale() locale: string,
  ) {
    return this.careers.apply(dto, file, { ip: request.ip, locale });
  }
}
