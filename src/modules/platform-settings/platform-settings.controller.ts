import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import type { User } from '../../generated/prisma/client';
import { AdminAuthGuard } from '../auth/guards/admin-auth.guard';
import {
  PlatformSettingsQueryDto,
  UpdatePlatformSettingsDto,
} from './dto/platform-settings.dto';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('27 Admin - Platform Settings')
@ApiBearerAuth('bearer')
@ApiUnauthorizedResponse({ description: 'A valid administrator session is required.' })
@ApiForbiddenResponse({ description: 'The administrator lacks the required settings permission.' })
@UseGuards(AdminAuthGuard, PermissionsGuard)
@Controller('admin/platform-settings')
export class PlatformSettingsController {
  constructor(private readonly settings: PlatformSettingsService) {}

  @Get()
  @Permissions('settings.read')
  @ApiOperation({
    summary: 'Get one or more platform-settings sections',
    description:
      'One read API powers General, Currency, Tax, Booking Rules, Service Radius, Commission Rules, Referral Rules, and the read-only Elite Program settings tab. Elite writes continue through the existing Elite Program API to avoid duplicated policy ownership.',
  })
  @ApiOkResponse({ description: 'Requested platform policy sections and runtime capability flags.' })
  get(@Query() query: PlatformSettingsQueryDto) {
    return this.settings.view(query.sections);
  }

  @Put()
  @Permissions('settings.manage')
  @ApiOperation({
    summary: 'Update one or several platform-settings sections atomically',
    description:
      'Only supplied fields are merged. Commission and global-tax policies affect NEW final booking charges. Automatic FX refresh and referral payouts are rejected until real provider/ledger integrations exist.',
  })
  @ApiBody({
    type: UpdatePlatformSettingsDto,
    examples: {
      commission: {
        summary: 'Update commission rules',
        value: {
          commission: {
            standardRatePercent: 15,
            goldRatePercent: 12,
            platinumRatePercent: 10,
            diamondRatePercent: 8,
            minimumCommissionAmount: 4.5,
            sameDaySurchargePercent: 2.5,
            weekendSurchargePercent: 1.5,
            categoryOverridesEnabled: true,
            categoryOverrides: [{ serviceId: 1, deltaPercent: 2 }],
          },
        },
      },
      tax: {
        summary: 'Enable a real global tax calculation',
        value: {
          tax: {
            mode: 'global',
            defaultRatePercent: 6.5,
            serviceSurchargeAmount: 2.5,
            inclusivePricing: false,
            receiptsEnabled: true,
          },
        },
      },
    },
  })
  update(@CurrentUser() actor: User, @Body() dto: UpdatePlatformSettingsDto) {
    return this.settings.update(actor, dto);
  }
}
