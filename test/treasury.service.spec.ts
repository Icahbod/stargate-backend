import { BadRequestException } from '@nestjs/common';
import { TreasuryService } from '../src/treasury/treasury.service';

describe('TreasuryService', () => {
  const mockPool = { query: jest.fn() };
  let service: TreasuryService;

  beforeEach(() => {
    mockPool.query.mockReset();
    service = new TreasuryService(mockPool as any);
  });

  it('rejects invalid signing quorum values', async () => {
    await expect(service.setSigningQuorum(0)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setSigningQuorum(-1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setSigningQuorum(1.5)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('persists signing quorum to the treasury configuration table', async () => {
    mockPool.query.mockResolvedValue({ rows: [{ signing_quorum: 3 }] });

    const result = await service.setSigningQuorum(3);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO treasury_configuration'),
      [3],
    );
    expect(result).toEqual({ signingQuorum: 3 });
  });
});
