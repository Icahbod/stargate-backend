import { Injectable } from '@nestjs/common';

@Injectable()
export class RateLimiterService {
  private counters = new Map<string, number>();

  increment(merchantId: string) {
    const current = this.counters.get(merchantId) ?? 0;
    this.counters.set(merchantId, current + 1);
  }

  getCount(merchantId: string) {
    return this.counters.get(merchantId) ?? 0;
  }

  reset(merchantId: string) {
    this.counters.delete(merchantId);
  }
}
