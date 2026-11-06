import { AuthService } from '../auth/auth.service';
import { DevicesService } from './devices.service';

interface Row {
  id: string;
  userId: string;
  token: string;
  platform: string;
  appVersion: string | null;
}

/**
 * In-memory DeviceToken table honouring the one constraint that matters:
 * `token` is unique globally (schema.prisma), so an upsert on token moves
 * the row instead of adding a second one.
 */
function fakeTable() {
  const rows: Row[] = [];
  let nextId = 1;
  const matches = (r: Row, where: Partial<Row>) =>
    Object.entries(where).every(([k, v]) => r[k as keyof Row] === v);
  const deviceToken = {
    upsert: jest.fn(async ({ where, create, update }: { where: { token: string }; create: Omit<Row, 'id'>; update: Partial<Row> }) => {
      const found = rows.find((r) => r.token === where.token);
      if (found) return Object.assign(found, update);
      const row = { id: `dt-${nextId++}`, ...create };
      rows.push(row);
      return row;
    }),
    deleteMany: jest.fn(async ({ where }: { where: Partial<Row> }) => {
      const before = rows.length;
      const keep = rows.filter((r) => !matches(r, where));
      rows.length = 0;
      rows.push(...keep);
      return { count: before - rows.length };
    }),
  };
  return { rows, deviceToken };
}

function setup() {
  const table = fakeTable();
  const prisma = {
    deviceToken: table.deviceToken,
    refreshToken: { updateMany: jest.fn(async () => ({ count: 1 })) },
  };
  const devices = new DevicesService(prisma as never);
  // Only prisma is touched by AuthService.logout; the other collaborators are unused here.
  const auth = new AuthService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never);
  const tokensOf = (userId: string) => table.rows.filter((r) => r.userId === userId).map((r) => r.token);
  return { table, devices, auth, tokensOf };
}

const PHONE = 'fcm-token-phone-1';

describe('DevicesService — a token belongs to a device, not a person', () => {
  it('register as A, log out, register as B: A has no tokens and the token now belongs to B', async () => {
    const { devices, auth, tokensOf, table } = setup();

    await devices.register('user-a', { token: PHONE, platform: 'android', appVersion: '1.0.2+11' });
    expect(tokensOf('user-a')).toEqual([PHONE]);

    await auth.logout('refresh-a', PHONE);
    expect(tokensOf('user-a')).toEqual([]);

    await devices.register('user-b', { token: PHONE, platform: 'android', appVersion: '1.0.2+11' });
    expect(tokensOf('user-a')).toEqual([]);
    expect(tokensOf('user-b')).toEqual([PHONE]);
    expect(table.rows).toHaveLength(1);
  });

  it('B signing in on A’s phone without A logging out first still moves the token (upsert on token)', async () => {
    const { devices, tokensOf, table } = setup();
    await devices.register('user-a', { token: PHONE, platform: 'ios' });
    await devices.register('user-b', { token: PHONE, platform: 'ios' });
    expect(tokensOf('user-a')).toEqual([]);
    expect(tokensOf('user-b')).toEqual([PHONE]);
    expect(table.rows).toHaveLength(1);
  });

  it('re-registering the same token (app restart, onTokenRefresh replay) updates the row instead of adding one', async () => {
    const { devices, table } = setup();
    await devices.register('user-a', { token: PHONE, platform: 'android', appVersion: '1.0.2+11' });
    await devices.register('user-a', { token: PHONE, platform: 'android', appVersion: '1.0.3+12' });
    expect(table.rows).toHaveLength(1);
    expect(table.rows[0].appVersion).toBe('1.0.3+12');
  });

  it('a refreshed token: the new one is registered and the old one stops belonging to anyone once the app unregisters it', async () => {
    const { devices, tokensOf } = setup();
    await devices.register('user-a', { token: 'old-token', platform: 'android' });
    await devices.register('user-a', { token: 'new-token', platform: 'android' });
    await devices.unregister('user-a', 'old-token');
    expect(tokensOf('user-a')).toEqual(['new-token']);
  });

  it('authenticated unregister is scoped to the caller — another account cannot remove this device', async () => {
    const { devices, tokensOf } = setup();
    await devices.register('user-a', { token: PHONE, platform: 'android' });
    await devices.unregister('user-b', PHONE);
    expect(tokensOf('user-a')).toEqual([PHONE]);
    await devices.unregister('user-a', PHONE);
    expect(tokensOf('user-a')).toEqual([]);
  });

  it('logout without a device token (web, or an old app build) still revokes the refresh token and touches no device rows', async () => {
    const { devices, auth, tokensOf, table } = setup();
    await devices.register('user-a', { token: PHONE, platform: 'android' });
    await expect(auth.logout('refresh-a')).resolves.toEqual({ ok: true });
    expect(tokensOf('user-a')).toEqual([PHONE]);
    expect(table.deviceToken.deleteMany).not.toHaveBeenCalled();
  });

  it('logout with an expired session (no refresh token left) still forgets the device', async () => {
    const { devices, auth, tokensOf } = setup();
    await devices.register('user-a', { token: PHONE, platform: 'android' });
    await auth.logout('', PHONE);
    expect(tokensOf('user-a')).toEqual([]);
  });
});
