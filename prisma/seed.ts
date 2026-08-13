import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@cobdata.local';
  const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';

  // Create or find the single Account (idempotent via fixed UUID)
  const account = await prisma.account.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'CobData',
    },
  });

  // Hash password with Argon2id
  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
  });

  // Create or find the ADMIN user (idempotent via unique email)
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      accountId: account.id,
      email,
      passwordHash,
      name: 'Admin',
      role: Role.ADMIN,
      isActive: true,
    },
  });

  console.log(
    `✓ Seed completed: Account "${account.name}" + ADMIN user "${email}"`,
  );
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
