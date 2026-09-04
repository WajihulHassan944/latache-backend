import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SERVICE_ICON_VALUES } from '../../../common/constants/service-icon.constant';
import { CreateServiceDto, UpdateServiceDto } from './create-service.dto';

const base = {
  name: 'Home Cleaning',
  description: 'Professional home cleaning services.',
  slug: 'home-cleaning',
  minimumHourlyRate: 15,
  maximumHourlyRate: 100,
};

describe('CreateServiceDto.icon', () => {
  it('accepts every curated icon key, so the admin picker and validation never drift apart', async () => {
    for (const icon of SERVICE_ICON_VALUES) {
      const dto = plainToInstance(CreateServiceDto, { ...base, icon });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    }
  });

  it('rejects an icon key that is not in the curated catalogue', async () => {
    const dto = plainToInstance(CreateServiceDto, { ...base, icon: 'NotARealIcon' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'icon')).toBe(true);
  });

  it('rejects a Cloudinary-style URL - icon is a symbolic key, never an uploaded asset', async () => {
    const dto = plainToInstance(CreateServiceDto, {
      ...base,
      icon: 'https://res.cloudinary.com/demo/image/upload/service.webp',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'icon')).toBe(true);
  });
});

describe('UpdateServiceDto.icon', () => {
  it('is optional but, when present, must be a curated icon key', async () => {
    const withoutIcon = plainToInstance(UpdateServiceDto, { name: 'Updated name' });
    expect(await validate(withoutIcon)).toHaveLength(0);

    const invalid = plainToInstance(UpdateServiceDto, { icon: 'NotARealIcon' });
    const errors = await validate(invalid);
    expect(errors.some((error) => error.property === 'icon')).toBe(true);
  });
});
