import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPrisma } from '../src/lib/db/prisma';
import { saveProvider } from '../src/features/ai-router/service';
import { createConnectionRepository } from '../src/features/ai-router/connection-repository';

// Opt-in check against a migrated PostgreSQL database; removes only its own temporary records.
const prisma = getPrisma();
const id = `ai-lock-check-${randomUUID()}`;
let providerId: string | undefined;
try {
  await prisma.user.create({
    data: { id, provider: 'GITHUB', providerUserId: id, username: id, role: 'ADMIN' }
  });
  providerId = await saveProvider(id, {
    name: id, alias: null, providerType: 'custom', authType: 'none', format: 'openai',
    baseUrl: 'https://8.8.8.8/v1', models: ['test-model'], priority: 100, enabled: true
  });
  assert.ok(await prisma.aiProvider.findUnique({ where: { id: providerId } }),
    'provider save must acquire its namespace lock with the real PostgreSQL adapter');
  const repository = createConnectionRepository();
  let active = 0;
  let maximum = 0;
  await Promise.all([0, 1].map(() => repository.withLock!(`${providerId}-primary`, async (locked) => {
    active++;
    maximum = Math.max(maximum, active);
    try {
      const credential = await locked.findById(`${providerId}-primary`);
      assert.equal(credential?.authType, 'none');
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally { active--; }
  })));
  assert.equal(maximum, 1, 'credential refresh locks must serialize across actual transactions');
  console.log('PostgreSQL provider-save and credential-lock checks passed');
} finally {
  if (providerId) await prisma.aiProvider.deleteMany({ where: { id: providerId } });
  await prisma.auditEvent.deleteMany({ where: { actorId: id } });
  await prisma.user.deleteMany({ where: { id } });
  await prisma.$disconnect();
}
