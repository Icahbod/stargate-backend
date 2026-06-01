import { BadRequestException } from '@nestjs/common';
import { TreasuryController } from '../src/treasury/treasury.controller';

describe('TreasuryController', () => {
  const mockKms = { signDigest: jest.fn() };
  const mockTreasuryService = { setSigningQuorum: jest.fn() };
  let controller: TreasuryController;

  beforeEach(() => {
    mockKms.signDigest.mockReset();
    mockTreasuryService.setSigningQuorum.mockReset();
    controller = new TreasuryController(mockKms as any, mockTreasuryService as any);
  });

  it('rejects missing digest', async () => {
    await expect(controller.sign({} as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects digest that is not 32 bytes', async () => {
    await expect(controller.sign({ digest: 'deadbeef' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calls kms.signDigest with correct bytes and returns hex signature', async () => {
    const digest = 'a'.repeat(64); // 32 bytes as hex
    const fakeSignature = Buffer.from('sig');
    mockKms.signDigest.mockResolvedValue(fakeSignature);
    const result = await controller.sign({ digest });
    expect(mockKms.signDigest).toHaveBeenCalledWith(Buffer.from(digest, 'hex'));
    expect(result).toEqual({ signature: fakeSignature.toString('hex') });
  });

  it('updates the signing quorum through the treasury service', async () => {
    mockTreasuryService.setSigningQuorum.mockResolvedValue({ signingQuorum: 3 });
    const result = await controller.updateSigningQuorum({ signingQuorum: 3 } as any);
    expect(mockTreasuryService.setSigningQuorum).toHaveBeenCalledWith(3);
    expect(result).toEqual({ signingQuorum: 3 });
  });
});
