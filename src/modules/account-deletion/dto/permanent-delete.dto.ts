import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export const PERMANENT_DELETE_MODES = ['safe', 'purge'] as const;
export type PermanentDeleteMode = (typeof PERMANENT_DELETE_MODES)[number];

export class PermanentDeleteDto {
  @ApiPropertyOptional({
    enum: PERMANENT_DELETE_MODES,
    default: 'safe',
    description:
      'safe (default): refuse with 409 ACCOUNT_PURGE_BLOCKED when the account has bookings, payments, ' +
      'ledgers, reviews, disputes, etc. purge: delete the account together with ALL of that data ' +
      '(bookings, payments, wallet/ledger rows, earnings, disputes, reviews, chats, calls, referrals, ' +
      'withdrawals). Counterparty wallet balances are rebalanced. Requires customers.purge / ' +
      'taskers.purge (Super Admin always allowed).',
  })
  @IsOptional()
  @IsIn(PERMANENT_DELETE_MODES)
  mode?: PermanentDeleteMode;

  @ApiProperty({
    enum: ['PERMANENT_DELETE'],
    example: 'PERMANENT_DELETE',
    description: 'Explicit irreversible-delete confirmation phrase.',
  })
  @IsString()
  @IsIn(['PERMANENT_DELETE'])
  confirmation!: 'PERMANENT_DELETE';

  @ApiProperty({
    example: 'Verified duplicate test account requested for permanent removal.',
    minLength: 10,
    maxLength: 1000,
  })
  @IsString()
  @Length(10, 1000)
  reason!: string;
}
