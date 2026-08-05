import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const services = [
  { name: 'Electrician', description: 'Wiring, fixtures and installations', slug: 'electrician', icon: 'Zap' },
  { name: 'Plumbing', description: 'Leaks, drains and pipe repairs', slug: 'plumbing', icon: 'Droplets' },
  { name: 'Painter', description: 'Interior and exterior wall perfection', slug: 'painter', icon: 'Paintbrush' },
  { name: 'Carpentry', description: 'Custom furniture and repair', slug: 'carpentry', icon: 'Hammer' },
  { name: 'Moving Help', description: 'Pack, lift and transport', slug: 'moving-help', icon: 'Truck' },
  { name: 'Gardening', description: 'Landscape and maintenance', slug: 'gardening', icon: 'Sprout' },
  { name: 'General Repair', description: 'Quick fixes for home issues', slug: 'general-repair', icon: 'Wrench' },
  { name: 'Cleaning', description: 'Home and office cleaning services', slug: 'cleaning', icon: 'Truck' },
] as const;

async function main(): Promise<void> {
  for (const service of services) {
    const existing = await prisma.service.findFirst({ where: { slug: service.slug } });
    if (existing) {
      await prisma.service.update({
        where: { id: existing.id },
        data: { ...service, updatedAt: new Date() },
      });
    } else {
      const now = new Date();
      await prisma.service.create({ data: { ...service, createdAt: now, updatedAt: now } });
    }
  }
}

void main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
