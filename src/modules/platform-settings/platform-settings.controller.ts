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
import { PlatformSettingsQueryDto, UpdatePlatformSettingsDto } from './dto/platform-settings.dto';
import { PlatformSettingsService } from './platform-settings.service';

@ApiTags('51 Admin - Platform Settings')
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
      'One read API powers General, Currency, Tax, Booking Rules (including the completion-approval window), Service Radius, Commission Rules, Tasker Finance clearance/debt policy, Referral Rules, and the read-only Elite Program settings tab. Currency exposes five application-managed market presets (US/USD, Morocco/MAD, Pakistan/PKR, France/EUR, Spain/EUR); exactly one market is operational at a time. Elite writes continue through the existing Elite Program API to avoid duplicated policy ownership.',
  })
  @ApiOkResponse({
    description: 'Requested platform policy sections and runtime capability flags.',
  })
  get(@Query() query: PlatformSettingsQueryDto) {
    return this.settings.view(query.sections);
  }

  @Put()
  @Permissions('settings.manage')
  @ApiOperation({
    summary: 'Update one or several platform-settings sections atomically',
    description:
      'Only supplied fields are merged. Currency, Referral/Rewards, and Commission/Elite-pricing policy changes are Super-Admin-only. Currency selects one of five application-managed static market presets; a cross-ISO switch is blocked while unsettled financial positions exist. Referral policy is snapshotted on new attributions and never rewrites settled rewards.',
  })
  @ApiBody({
    type: UpdatePlatformSettingsDto,
    examples: {
      currency: {
        summary: 'Select Morocco as the operational market',
        value: {
          currency: {
            primaryMarket: 'morocco',
          },
        },
      },
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
      taskerFinance: {
        summary: 'Configure Tasker earnings clearance and cash-debt ceiling',
        value: {
          taskerFinance: {
            earningClearanceDays: 14,
            cashDisputeClearanceDays: 14,
            maximumOutstandingPlatformDebt: 250,
            blockCashBookingsAtDebtLimit: true,
          },
        },
      },
      referral: {
        summary: 'Enable a configured Customer referral policy for future claims only',
        value: {
          referral: {
            clientReferralEnabled: true,
            uniqueCodesEnabled: true,
            clientReferralBonus: 10,
            referredClientDiscountPercent: 10,
            referredClientDiscountMaxAmount: 25,
            minimumCustomerChargeAmount: 5,
            minimumQualifyingBookingAmount: 25,
            referralExpiryDays: 90,
            rewardClearanceDays: 14,
            maxClientReferrals: 0,
          },
        },
      },
      completionApproval: {
        summary: 'Configure the Customer review window for future Tasker submissions',
        value: {
          bookingRules: {
            completionApprovalHours: 24,
          },
        },
      },
      localizedGeneral: {
        summary: 'Update English/Arabic/Darija public platform content',
        value: {
          general: {
            platformName: 'Latache',
            description: 'A trusted service marketplace.',
            translations: [
              {
                locale: 'en',
                platformName: 'Latache',
                description: 'A trusted service marketplace.',
              },
              { locale: 'ar', platformName: 'Latache', description: 'منصة موثوقة للخدمات.' },
              {
                locale: 'ary',
                platformName: 'Latache',
                description: 'منصة ديال خدمات موثوقة.',
              },
            ],
          },
        },
      },
    },
  })
  update(@CurrentUser() actor: User, @Body() dto: UpdatePlatformSettingsDto) {
    return this.settings.update(actor, dto);
  }
}
