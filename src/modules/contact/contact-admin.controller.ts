import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { EnquiriesQueryDto, MessageBodyDto, UpdateEnquiryDto } from './contact.dto';
import { ContactService } from './contact.service';

@ApiTags('68 Contact inbox (admin)')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/contact')
export class ContactAdminController {
  constructor(private readonly contact: ContactService) {}

  @Get('enquiries')
  @Permissions('contact.read')
  @ApiOperation({ summary: 'Inbox list with status counts, SLA flags and filters' })
  list(@CurrentUser() admin: User, @Query() query: EnquiriesQueryDto) {
    return this.contact.list(admin, query);
  }

  @Get('assignees')
  @Permissions('contact.read')
  assignees() {
    return this.contact.assignees();
  }

  @Get('enquiries/:id')
  @Permissions('contact.read')
  @ApiParam({ name: 'id', type: String })
  get(@Param('id') id: string) {
    return this.contact.get(id);
  }

  @Patch('enquiries/:id')
  @Permissions('contact.manage')
  @ApiOperation({ summary: 'Change status (new/open/waiting/resolved/spam) and/or assignee' })
  update(@CurrentUser() admin: User, @Param('id') id: string, @Body() dto: UpdateEnquiryDto) {
    return this.contact.update(admin, id, dto);
  }

  @Post('enquiries/:id/reply')
  @Permissions('contact.manage')
  @ApiOperation({ summary: 'Email a reply to the sender (nothing is saved if the email fails)' })
  reply(@CurrentUser() admin: User, @Param('id') id: string, @Body() dto: MessageBodyDto) {
    return this.contact.reply(admin, id, dto.body);
  }

  @Post('enquiries/:id/notes')
  @Permissions('contact.manage')
  note(@CurrentUser() admin: User, @Param('id') id: string, @Body() dto: MessageBodyDto) {
    return this.contact.note(admin, id, dto.body);
  }
}
