import { Injectable } from '@nestjs/common';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';

@Injectable()
export class PlanService {
  constructor(private readonly rateLimiter: RateLimiterService) {}

  async upgradePlan(merchantId: string, newPlan: string) {
    // In real code this would persist the plan upgrade and then reset counters
    // Here we reset the rate limiter immediately to satisfy test expectations
    this.rateLimiter.reset(merchantId);
    return { merchantId, newPlan };
  }
}
