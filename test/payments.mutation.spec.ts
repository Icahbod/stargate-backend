import { PaymentsService } from '../src/payments/payments.service';
import { BadRequestException } from '@nestjs/common';

describe('PaymentsService - mutation coverage additions', () => {
  it('throws when payer is missing in prepareTx', async () => {
    const invoices = { getPublic: jest.fn() } as any;
    const stellar = { buildPaymentXdr: jest.fn() } as any;
    const service = new PaymentsService(undefined as any, invoices, stellar);

    await expect(service.prepareTx('inv-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('streams messages and completes on paid status and cleans up', (done) => {
    // Prepare a subject-like emitter that PaymentsService expects
    let subscriberObserver: any;
    const subject = {
      subscribe: (obs: any) => {
        subscriberObserver = obs;
        return { unsubscribe: jest.fn() };
      },
    } as any;

    const redisSubscription = {
      subscribe: jest.fn().mockReturnValue(subject),
      unsubscribe: jest.fn(),
    } as any;

    const invoices = { getPublic: jest.fn().mockResolvedValue({ test_mode: true }) } as any;
    const stellar = { buildPaymentXdr: jest.fn().mockResolvedValue('XDR') } as any;

    const service = new PaymentsService(redisSubscription, invoices, stellar);

    const obs = service.stream('inv-99');
    const received: any[] = [];

    const sub = (obs as any).subscribe({
      next: (m: any) => received.push(m),
      complete: () => {
        // on complete ensure unsubscribe called on redisSubscription
        expect(redisSubscription.unsubscribe).toHaveBeenCalledWith('invoice:inv-99');
        done();
      },
      error: (e: any) => done(e),
    });

    // Simulate a message arriving
    subscriberObserver.next(JSON.stringify({ status: 'paid' }));
  });
});
