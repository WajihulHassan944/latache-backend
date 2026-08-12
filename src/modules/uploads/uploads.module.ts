import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { AuthModule } from '../auth/auth.module';
import { CLOUDINARY_CLIENT } from './cloudinary.constants';
import { RegistrationUploadsController, UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import type { CloudinaryClient } from './uploads.types';

@Module({
  imports: [AuthModule],
  controllers: [RegistrationUploadsController, UploadsController],
  providers: [
    {
      provide: CLOUDINARY_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): CloudinaryClient => {
        cloudinary.config({
          cloud_name: config.getOrThrow<string>('cloudinary.cloudName'),
          api_key: config.getOrThrow<string>('cloudinary.apiKey'),
          api_secret: config.getOrThrow<string>('cloudinary.apiSecret'),
          secure: true,
        });
        return cloudinary as unknown as CloudinaryClient;
      },
    },
    UploadsService,
  ],
  exports: [UploadsService],
})
export class UploadsModule {}
