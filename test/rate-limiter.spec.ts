import { RateLimiterService } from '../src/rate-limiter/rate-limiter.service';
import { PlanService } from '../src/plan/plan.service';

describe('RateLimiter reset on plan upgrade', () => {
  it('clears the counter immediately after upgrade', async () => {
    const rl = new RateLimiterService();
    rl.increment('mer-1');
    rl.increment('mer-1');
    expect(rl.getCount('mer-1')).toBe(2);

    const plan = new PlanService(rl);
    await plan.upgradePlan('mer-1', 'pro');

    expect(rl.getCount('mer-1')).toBe(0);
  });
});
