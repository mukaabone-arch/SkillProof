import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListCandidatesQueryDto } from './admin.dto';

/**
 * The hard pageSize max (100) is enforced entirely by class-validator on
 * this DTO, via the global ValidationPipe (main.ts) — a request that fails
 * this never reaches AdminService.listCandidates at all, so it can only be
 * proven here, not in that service's own spec. Same plainToInstance/validate
 * pair AdminService itself already uses for bulk question validation.
 */
describe('ListCandidatesQueryDto', () => {
  it('defaults to page 1, pageSize 25, sort createdAt desc when nothing is supplied', async () => {
    const dto = plainToInstance(ListCandidatesQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(25);
    expect(dto.sort).toBe('createdAt');
    expect(dto.order).toBe('desc');
  });

  it('accepts pageSize at exactly the hard max (100)', async () => {
    const dto = plainToInstance(ListCandidatesQueryDto, { pageSize: '100' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects pageSize above the hard max (100)', async () => {
    const dto = plainToInstance(ListCandidatesQueryDto, { pageSize: '101' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'pageSize')).toBe(true);
  });

  it('rejects an unknown sort value', async () => {
    const dto = plainToInstance(ListCandidatesQueryDto, { sort: 'email' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'sort')).toBe(true);
  });

  it('trims a search value with surrounding whitespace', () => {
    const dto = plainToInstance(ListCandidatesQueryDto, { search: '  jordan  ' });
    expect(dto.search).toBe('jordan');
  });
});
