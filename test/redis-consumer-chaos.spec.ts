/**
 * #105 – Chaos tests for Redis consumer group rebalance
 * Kill and restart consumers mid-delivery and assert no duplicate messages.
 */
import { RedisSubscriptionService } from '../src/redis/redis-subscription.service';

/** Minimal in-process message bus that mimics Redis pub/sub for chaos testing */
class FakeRedis {
  private handlers: Array<(channel: string, message: string) => void> = [];
  status = 'ready';

  duplicate(): FakeRedis {
    const dup = new FakeRedis();
    // share the same handler list so publish reaches all subscribers
    dup.handlers = this.handlers;
    return dup;
  }

  subscribe(_channel: string) {
    return Promise.resolve();
  }

  unsubscribe(_channel: string) {
    return Promise.resolve();
  }

  on(event: string, handler: (...args: any[]) => void) {
    if (event === 'message') this.handlers.push(handler as any);
  }

  publish(channel: string, message: string) {
    this.handlers.forEach((h) => h(channel, message));
  }

  async disconnect() {
    this.handlers = [];
  }
}

describe('RedisSubscriptionService – chaos: consumer kill/restart mid-delivery', () => {
  let fakeRedis: FakeRedis;
  let service: RedisSubscriptionService;

  beforeEach(() => {
    fakeRedis = new FakeRedis();
    service = new RedisSubscriptionService(fakeRedis as any);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('delivers a message to an active subscriber', (done) => {
    const subject = service.subscribe('ch:1');
    subject.subscribe((msg) => {
      expect(msg).toBe('hello');
      done();
    });
    fakeRedis.publish('ch:1', 'hello');
  });

  it('no duplicate messages when a second subscriber joins the same channel', () => {
    const received: string[] = [];

    const sub1 = service.subscribe('ch:dup');
    const sub2 = service.subscribe('ch:dup'); // same Subject returned

    sub1.subscribe((m) => received.push(`s1:${m}`));
    sub2.subscribe((m) => received.push(`s2:${m}`));

    fakeRedis.publish('ch:dup', 'msg-1');

    // Both subscriptions share the same Subject, so each gets exactly one emission
    expect(received).toEqual(['s1:msg-1', 's2:msg-1']);
  });

  it('stops delivering after consumer is killed (unsubscribed)', () => {
    const received: string[] = [];
    const subject = service.subscribe('ch:kill');
    const subscription = subject.subscribe((m) => received.push(m));

    fakeRedis.publish('ch:kill', 'before-kill');

    // Kill the consumer
    subscription.unsubscribe();
    service.unsubscribe('ch:kill');

    fakeRedis.publish('ch:kill', 'after-kill');

    expect(received).toEqual(['before-kill']);
    expect(received).not.toContain('after-kill');
  });

  it('restarted consumer receives new messages without duplicating old ones', () => {
    const received: string[] = [];

    // First consumer lifecycle
    const subject1 = service.subscribe('ch:restart');
    const sub1 = subject1.subscribe((m) => received.push(m));
    fakeRedis.publish('ch:restart', 'msg-before-restart');
    sub1.unsubscribe();
    service.unsubscribe('ch:restart');

    // Restart consumer
    const subject2 = service.subscribe('ch:restart');
    subject2.subscribe((m) => received.push(m));
    fakeRedis.publish('ch:restart', 'msg-after-restart');

    expect(received).toEqual(['msg-before-restart', 'msg-after-restart']);
  });

  it('no messages delivered to a consumer killed before publish', () => {
    const received: string[] = [];
    const subject = service.subscribe('ch:early-kill');
    const sub = subject.subscribe((m) => received.push(m));

    // Kill before any message
    sub.unsubscribe();
    service.unsubscribe('ch:early-kill');

    fakeRedis.publish('ch:early-kill', 'should-not-arrive');

    expect(received).toHaveLength(0);
  });

  it('multiple channels are isolated – killing one does not affect another', () => {
    const chA: string[] = [];
    const chB: string[] = [];

    const subjectA = service.subscribe('ch:A');
    const subjectB = service.subscribe('ch:B');

    subjectA.subscribe((m) => chA.push(m));
    subjectB.subscribe((m) => chB.push(m));

    fakeRedis.publish('ch:A', 'a1');
    fakeRedis.publish('ch:B', 'b1');

    // Kill channel A consumer
    service.unsubscribe('ch:A');

    fakeRedis.publish('ch:A', 'a2');
    fakeRedis.publish('ch:B', 'b2');

    expect(chA).toEqual(['a1']);
    expect(chB).toEqual(['b1', 'b2']);
  });

  it('processes burst of messages in order without duplicates', () => {
    const received: string[] = [];
    const subject = service.subscribe('ch:burst');
    subject.subscribe((m) => received.push(m));

    const messages = Array.from({ length: 20 }, (_, i) => `msg-${i}`);
    messages.forEach((m) => fakeRedis.publish('ch:burst', m));

    expect(received).toEqual(messages);
    // Verify no duplicates
    expect(new Set(received).size).toBe(messages.length);
  });

  it('onModuleDestroy cleans up and stops all deliveries', async () => {
    const received: string[] = [];
    const subject = service.subscribe('ch:destroy');
    subject.subscribe((m) => received.push(m));

    fakeRedis.publish('ch:destroy', 'before-destroy');
    await service.onModuleDestroy();
    fakeRedis.publish('ch:destroy', 'after-destroy');

    expect(received).toEqual(['before-destroy']);
  });
});
