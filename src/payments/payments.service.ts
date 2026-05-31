import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Observable } from 'rxjs';
import { InvoicesService } from '../invoices/invoices.service';
import { RedisSubscriptionService } from '../redis/redis-subscription.service';
import { StellarService } from '../stellar/stellar.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly redisSubscription: RedisSubscriptionService,
    private readonly invoices: InvoicesService,
    private readonly stellar: StellarService,
  ) {}

  async prepareTx(id: string, payer?: string) {
    /**
     * Prepare a transaction XDR for a payment for the given invoice.
     * @param id - invoice id
     * @param payer - account initiating the payment
     */
    if (!payer) throw new BadRequestException('payer query parameter is required');
    const invoice = await this.invoices.getPublic(id);
    return { xdr: await this.stellar.buildPaymentXdr(invoice, payer, invoice.test_mode), network: invoice.test_mode ? 'testnet' : (process.env.STELLAR_NETWORK ?? 'testnet') };
  }

  stream(invoiceId: string) {
    /**
     * Stream real-time invoice events via an Observable.
     * @param invoiceId - invoice id to stream events for
     */
    return new Observable<MessageEvent>((subscriber) => {
      const channel = `invoice:${invoiceId}`;
      const subject = this.redisSubscription.subscribe(channel);
      const heartbeat = setInterval(() => subscriber.next({ data: { type: 'heartbeat' } } as MessageEvent), 15_000);
      const subscription = subject.subscribe({
        next: (message) => {
          const data = JSON.parse(message);
          subscriber.next({ data } as MessageEvent);
          if (data.status === 'paid' || data.status === 'expired') subscriber.complete();
        },
        error: (err) => subscriber.error(err),
      });

      return () => {
        clearInterval(heartbeat);
        subscription.unsubscribe();
        this.redisSubscription.unsubscribe(channel);
      };
    });
  }
}
