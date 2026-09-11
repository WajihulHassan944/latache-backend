import { TaskerProfileService } from './tasker-profile.service';

describe('TaskerProfileService — business profile workImages', () => {
  const taskerId = 58;
  const baseUser = {
    id: taskerId,
    yearsOfExperience: 3,
    isProfilePublic: true,
    serviceAreaLabel: null,
    serviceAreaLat: null,
    serviceAreaLng: null,
    serviceAreaRadiusKm: null,
    serviceAreaCity: null,
    serviceAreaArea: null,
    workImages: [] as string[],
  };

  function buildService() {
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue(baseUser),
        update: jest.fn(),
      },
      service: { findMany: jest.fn().mockResolvedValue([]) },
      userService: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const sessions = {};
    const platformSettings = {
      currencyContext: jest.fn().mockResolvedValue({ code: 'USD', symbol: '$', rate: 1 }),
    };
    const service = new TaskerProfileService(
      prisma as never,
      sessions as never,
      platformSettings as never,
    );
    return { service, prisma };
  }

  it('defaults workImages to [] when the column is null', async () => {
    const { service, prisma } = buildService();
    prisma.user.findFirst.mockResolvedValue({ ...baseUser, workImages: null });

    const result = await service.business(taskerId);

    expect(result.workImages).toEqual([]);
  });

  it('persists workImages when provided in the update payload', async () => {
    const { service, prisma } = buildService();
    const workImages = ['https://res.cloudinary.com/demo/image/upload/tasker-work-images/a.webp'];
    prisma.user.update.mockResolvedValue({ ...baseUser, workImages });

    const result = await service.updateBusiness(taskerId, { workImages } as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: taskerId },
      data: { workImages },
    });
    expect(result.workImages).toEqual(workImages);
  });

  it('leaves workImages untouched when omitted from the update payload', async () => {
    const { service, prisma } = buildService();
    prisma.user.update.mockResolvedValue(baseUser);

    await service.updateBusiness(taskerId, { yearsOfExperience: 5 } as never);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: taskerId },
      data: { yearsOfExperience: 5 },
    });
  });
});
