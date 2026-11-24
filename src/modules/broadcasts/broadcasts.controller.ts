import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import { BroadcastsService, type Audience } from './broadcasts.service';

const AUDIENCES = ['customers', 'taskers', 'everyone'] as const;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CreateBroadcastDto {
  @Transform(trim) @IsString() @Length(3, 120) title!: string;
  @Transform(trim) @IsString() @Length(5, 500) body!: string;
  @IsIn(AUDIENCES) audience!: Audience;
}

class ListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

class AudienceQueryDto {
  @IsIn(AUDIENCES) audience!: Audience;
}

@ApiTags('70 Announcements (admin)')
@ApiBearerAuth('bearer')
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/broadcasts')
export class BroadcastsController {
  constructor(private readonly broadcasts: BroadcastsService) {}

  @Get()
  @Permissions('broadcasts.read')
  list(@Query() query: ListQueryDto) {
    return this.broadcasts.list(query);
  }

  @Get('audience-size')
  @Permissions('broadcasts.read')
  @ApiOperation({ summary: 'How many active users an audience contains (shown before sending)' })
  async size(@Query() query: AudienceQueryDto) {
    return { audience: query.audience, count: await this.broadcasts.audienceCount(query.audience) };
  }

  @Post()
  @Permissions('broadcasts.manage')
  @ApiOperation({ summary: 'Save an announcement as a draft' })
  create(@CurrentUser() admin: User, @Body() dto: CreateBroadcastDto) {
    return this.broadcasts.create(admin, dto);
  }

  @Post(':id/send')
  @Permissions('broadcasts.manage')
  @ApiParam({ name: 'id', type: String })
  @ApiOperation({ summary: 'Send a draft to its audience (in-app + push). Delivered in the background; poll the list for progress.' })
  send(@CurrentUser() admin: User, @Param('id') id: string) {
    return this.broadcasts.send(admin, id);
  }

  @Delete(':id')
  @Permissions('broadcasts.manage')
  @ApiParam({ name: 'id', type: String })
  remove(@CurrentUser() admin: User, @Param('id') id: string) {
    return this.broadcasts.remove(admin, id);
  }
}
