import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateTaskerBusinessProfileDto } from './tasker-dashboard.dto';

describe('UpdateTaskerBusinessProfileDto.workImages', () => {
  it('is optional', async () => {
    const dto = plainToInstance(UpdateTaskerBusinessProfileDto, {});
    expect(await validate(dto)).toHaveLength(0);
  });

  it('accepts up to 6 https Cloudinary URLs', async () => {
    const workImages = Array.from(
      { length: 6 },
      (_, i) => `https://res.cloudinary.com/demo/image/upload/tasker-work-images/${i}.webp`,
    );
    const dto = plainToInstance(UpdateTaskerBusinessProfileDto, { workImages });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects more than 6 items', async () => {
    const workImages = Array.from(
      { length: 7 },
      (_, i) => `https://res.cloudinary.com/demo/image/upload/tasker-work-images/${i}.webp`,
    );
    const dto = plainToInstance(UpdateTaskerBusinessProfileDto, { workImages });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'workImages')).toBe(true);
  });

  it('rejects a non-https URL', async () => {
    const dto = plainToInstance(UpdateTaskerBusinessProfileDto, {
      workImages: ['http://res.cloudinary.com/demo/image/upload/example.webp'],
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'workImages')).toBe(true);
  });

  it('rejects a URL longer than 500 characters', async () => {
    const longUrl = `https://res.cloudinary.com/demo/image/upload/${'a'.repeat(480)}.webp`;
    expect(longUrl.length).toBeGreaterThan(500);
    const dto = plainToInstance(UpdateTaskerBusinessProfileDto, { workImages: [longUrl] });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'workImages')).toBe(true);
  });
});
