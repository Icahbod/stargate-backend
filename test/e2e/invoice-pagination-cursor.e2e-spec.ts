import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { AppModule } from '../../src/app.module';

describe('Invoice pagination cursor correctness (e2e)', () => {
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

  it('returns no duplicate invoices when new invoices are inserted between pages', async () => {
    const createInvoice = async (description: string) =>
      app
        .getHttpServer()
        .post('/invoices')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ amount_usdc: '5.00', description, expires_in_minutes: 60 });

    const resA = await createInvoice('Invoice A');
    const resB = await createInvoice('Invoice B');
    const resC = await createInvoice('Invoice C');

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect(resC.status).toBe(201);

    const page1 = await app
      .getHttpServer()
      .get('/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ limit: 2 });

    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(2);
    const page1Ids = page1.body.items.map((invoice: any) => invoice.id);
    const cursor = page1.body.nextCursor;
    expect(cursor).toBeDefined();

    const resD = await createInvoice('Invoice D');
    expect(resD.status).toBe(201);

    const page2 = await app
      .getHttpServer()
      .get('/invoices')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ limit: 2, cursor });

    expect(page2.status).toBe(200);
    expect(page2.body.items).toHaveLength(2);
    const page2Ids = page2.body.items.map((invoice: any) => invoice.id);
    expect(page2Ids.some((id: string) => page1Ids.includes(id))).toBe(false);
  });
});
