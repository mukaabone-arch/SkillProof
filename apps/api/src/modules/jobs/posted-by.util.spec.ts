import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertOrgClient } from './posting-client.util';
import { CONFIDENTIAL_CLIENT, postedByFields, postedByText, postedFor } from './posted-by.util';

const own = { organization: { name: 'Acme' }, hideClientName: true, postedForClient: null };
const hidden = { organization: { name: 'Talent Partners' }, hideClientName: true, postedForClient: { name: 'Globex' } };
const shown = { ...hidden, hideClientName: false };

describe('posted-by labels', () => {
  it("names only the employer on an employer's own job", () => {
    expect(postedFor(own)).toBeNull();
    expect(postedByText(own)).toBe('Acme');
    expect(postedByFields(own)).toEqual({ orgName: 'Acme', postedFor: null, agencyPosting: false });
  });

  it('names the agency and the client when the recruiter shows it', () => {
    expect(postedByText(shown)).toBe('Talent Partners for Globex');
    expect(postedByFields(shown)).toEqual({ orgName: 'Talent Partners', postedFor: 'Globex', agencyPosting: true });
  });

  it('never carries a hidden client name in any candidate field', () => {
    expect(postedByText(hidden)).toBe(`Talent Partners for ${CONFIDENTIAL_CLIENT}`);
    const fields = postedByFields(hidden);
    expect(fields.postedFor).toBe(CONFIDENTIAL_CLIENT);
    expect(JSON.stringify(fields)).not.toContain('Globex');
  });
});

describe('assertOrgClient', () => {
  function prisma(type: OrgType, client: { id: string } | null = { id: 'c1' }) {
    const p = {
      organization: { findUniqueOrThrow: jest.fn(async () => ({ type })) },
      staffingClient: { findFirst: jest.fn(async () => client) },
    };
    return p as unknown as PrismaService & typeof p;
  }

  it('rejects a client on an employer job, and needs none', async () => {
    await expect(assertOrgClient(prisma(OrgType.EMPLOYER), 'o1', 'c1', true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertOrgClient(prisma(OrgType.EMPLOYER), 'o1', undefined, true)).resolves.toBe(OrgType.EMPLOYER);
  });

  it('requires a recruiter to name one of its own unarchived clients', async () => {
    await expect(assertOrgClient(prisma(OrgType.STAFFING), 'o1', undefined, true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertOrgClient(prisma(OrgType.STAFFING), 'o1', null, true)).rejects.toBeInstanceOf(BadRequestException);
    await expect(assertOrgClient(prisma(OrgType.STAFFING, null), 'o1', 'other-org-client', true)).rejects.toBeInstanceOf(NotFoundException);

    const p = prisma(OrgType.STAFFING);
    await expect(assertOrgClient(p, 'o1', 'c1', true)).resolves.toBe(OrgType.STAFFING);
    expect(p.staffingClient.findFirst).toHaveBeenCalledWith({ where: { id: 'c1', orgId: 'o1', archivedAt: null }, select: { id: true } });
  });
});
