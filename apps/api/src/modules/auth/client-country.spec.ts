import { PrismaService } from '../../prisma/prisma.service';
import { parseClientCountry, recordClientCountry } from './client-country';

describe('client country', () => {
  it('accepts two-letter codes only', () => {
    expect(parseClientCountry('in')).toBe('IN');
    expect(parseClientCountry(' AE ')).toBe('AE');
    expect(parseClientCountry(['GB', 'US'])).toBe('GB');
    expect(parseClientCountry('IND')).toBeNull();
    expect(parseClientCountry('')).toBeNull();
    expect(parseClientCountry(undefined)).toBeNull();
  });

  it('records the first report only', async () => {
    const prisma = { user: { updateMany: jest.fn(async () => ({ count: 1 })) } };
    const p = prisma as unknown as PrismaService;
    await expect(recordClientCountry(p, 'u1', null, 'ae')).resolves.toBe('AE');
    expect(prisma.user.updateMany).toHaveBeenCalledWith({ where: { id: 'u1', country: null }, data: { country: 'AE' } });

    prisma.user.updateMany.mockClear();
    await expect(recordClientCountry(p, 'u1', 'IN', 'AE')).resolves.toBe('IN');
    await expect(recordClientCountry(p, 'u1', null, undefined)).resolves.toBeNull();
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
