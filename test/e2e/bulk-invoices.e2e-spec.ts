import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';

describe('Bulk invoice creation (e2e)', () => {
  let app: INestApplication;
  let pool: Pool;
  let merchantId: string;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    const configService = app.get(ConfigService);
    pool = new Pool({ connectionString: configService.getOrThrow<string>('DATABASE_URL') });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  beforeEach(async () => {
    const registerRes = await app
      .getHttpServer()
      .post('/auth/register')
      .send({
        email: `merchant-${Date.now()}@test.com`,
        password: 'TestPassword123!',
      });

    merchantId = registerRes.body.merchant_id;

    const loginRes = await app
      .getHttpServer()
      .post('/auth/login')
      .send({
        email: registerRes.body.email,
        password: 'TestPassword123!',
      });

    authToken = loginRes.body.access_token;
  });

  afterEach(async () => {
    await pool.query('DELETE FROM invoices WHERE merchant_id = $1', [merchantId]);
    await pool.query('DELETE FROM merchants WHERE id = $1', [merchantId]);
  });

  it('creates 100 invoices atomically in a single bulk request', async () => {
    const payload = Array.from({ length: 100 }, (_, index) => ({
      amount_usdc: '1.00',
      description: `Bulk invoice ${index}`,
      expires_in_minutes: 60,
    }));

    const res = await app
      .getHttpServer()
      .post('/invoices/bulk')
      .set('Authorization', `Bearer ${authToken}`)
      .send(payload);

    expect([200, 201]).toContain(res.status);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(100);
    const uniqueIds = new Set(res.body.map((invoice: any) => invoice.id));
    expect(uniqueIds.size).toBe(100);

    const dbCount = await pool.query('SELECT COUNT(*) AS count FROM invoices WHERE merchant_id = $1', [merchantId]);
    expect(Number(dbCount.rows[0].count)).toBe(100);
  });
});
