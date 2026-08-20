import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean } from 'class-validator';

export class AddCustomerRoleDto {
  @ApiProperty({
    example: true,
    description: 'Confirms the current Latache Terms and Privacy consent while enabling Customer access.',
  })
  @IsBoolean()
  @Equals(true, { message: 'acceptedTermsAndPrivacyPolicy must be true' })
  acceptedTermsAndPrivacyPolicy!: true;
}
