import { PrismaService } from '../../prisma/prisma.service';

/** Header the web and mobile clients send with their best guess at the user's country. */
export const CLIENT_COUNTRY_HEADER = 'x-client-country';

/** A plausible ISO 3166-1 alpha-2 code from the header, or null. "ZZ" is the clients' "known, but not one we map". */
export function parseClientCountry(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/**
 * Records the client's country the first time we see one for this user,
 * and returns the user's country after that. First report wins, so later
 * travel (or changing the device's time zone) doesn't flip the phone rule.
 */
export async function recordClientCountry(
  prisma: PrismaService,
  userId: string,
  current: string | null,
  header: string | string[] | undefined,
): Promise<string | null> {
  if (current) return current;
  const country = parseClientCountry(header);
  if (!country) return null;
  await prisma.user.updateMany({ where: { id: userId, country: null }, data: { country } });
  return country;
}
