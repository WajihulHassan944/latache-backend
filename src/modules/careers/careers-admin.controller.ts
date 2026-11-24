import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import {
  AddNoteDto,
  AdminApplicationsQueryDto,
  AdminJobsQueryDto,
  AnalyticsQueryDto,
  JobUpsertDto,
  SendCandidateEmailDto,
  UpdateApplicationDto,
} from './careers.dto';
import { CareersService } from './careers.service';

@ApiTags('65 Careers (admin)')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/careers')
export class CareersAdminController {
  constructor(private readonly careers: CareersService) {}

  @Get('jobs')
  @Permissions('careers.read')
  @ApiOperation({ summary: 'All jobs with application counts and status totals' })
  jobs(@Query() query: AdminJobsQueryDto) {
    return this.careers.adminListJobs(query);
  }

  @Get('jobs/:id')
  @Permissions('careers.read')
  @ApiParam({ name: 'id', type: String })
  job(@Param('id') id: string) {
    return this.careers.adminGetJob(id);
  }

  @Post('jobs')
  @Permissions('careers.manage')
  @ApiOperation({ summary: 'Create a job (draft by default; status=open publishes it)' })
  create(@CurrentUser() actor: User, @Body() dto: JobUpsertDto) {
    return this.careers.createJob(actor, dto);
  }

  @Patch('jobs/:id')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  update(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: JobUpsertDto) {
    return this.careers.updateJob(actor, id, dto);
  }

  @Post('jobs/:id/publish')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  publish(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.careers.setJobStatus(actor, id, 'open');
  }

  @Post('jobs/:id/close')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  close(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.careers.setJobStatus(actor, id, 'closed');
  }

  @Post('jobs/:id/unpublish')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  unpublish(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.careers.setJobStatus(actor, id, 'draft');
  }

  @Delete('jobs/:id')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Delete a job that has no applications (otherwise close it)' })
  remove(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.careers.deleteJob(actor, id);
  }

  @Get('applications')
  @Permissions('careers.read')
  @ApiOperation({
    summary: 'Applications (kanban feed): filter by job / stage / search; stageCounts for the board headers',
    description: 'jobId=general lists general applications. Default limit 100 (max 300), newest stage change first.',
  })
  applications(@Query() query: AdminApplicationsQueryDto) {
    return this.careers.adminListApplications(query);
  }

  @Get('applications/:id')
  @Permissions('careers.read')
  @ApiParam({ name: 'id', type: String })
  application(@Param('id') id: string) {
    return this.careers.adminGetApplication(id);
  }

  @Get('applications/:id/cv')
  @Permissions('careers.read')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Signed 5-minute download link for the candidate CV (audited)' })
  cv(@CurrentUser() actor: User, @Param('id') id: string) {
    return this.careers.cvDownloadUrl(actor, id);
  }

  @Patch('applications/:id')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Move a candidate to another stage and/or set the 1-5 rating' })
  updateApplication(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: UpdateApplicationDto) {
    return this.careers.updateApplication(actor, id, dto);
  }

  @Post('applications/:id/notes')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  note(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: AddNoteDto) {
    return this.careers.addNote(actor, id, dto.body);
  }

  @Post('applications/:id/email')
  @Permissions('careers.manage')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Email the candidate with a branded template (screening_invite, interview_invite, offer, rejection)' })
  email(@CurrentUser() actor: User, @Param('id') id: string, @Body() dto: SendCandidateEmailDto) {
    return this.careers.sendCandidateEmail(actor, id, dto);
  }

  @Get('analytics')
  @Permissions('careers.read')
  @ApiOperation({ summary: 'Hiring analytics: totals, funnel, applications per role, sources, daily trend, time to hire' })
  analytics(@Query() query: AnalyticsQueryDto) {
    return this.careers.analytics(query.days ?? 30);
  }
}
