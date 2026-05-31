/**
 * scripts/seed.ts
 *
 * Creates demo merchants, invoices, and webhooks for local development.
 * Usage: npm run db:seed
 *
 * Requires DATABASE_URL in environment (or .env file).
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { Pool } from 'pg';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth/password';

config(); // load .env

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const DEMO_MERCHANTS = [
  { email: 'alice@demo.local', name: 'Alice Payments', password: 'demo-password-1' },
  { email: 'bob@demo.local', name: 'Bob Commerce', password: 'demo-password-2' },
];

const WEBHOOK_EVENTS = [
  'invoice.paid',
  'invoice.expired',
  'invoice.cancelled',
  'settlement.completed',
] as const;

async function seed() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('🌱 Seeding local development database...\n');

    for (const demo of DEMO_MERCHANTS) {
      // Upsert merchant
      const passwordHash = await hashPassword(demo.password);
      const merchantRes = await pool.query<{ id: string }>(
        `INSERT INTO merchants (email, name, password_hash, status, stellar_address, muxed_base_id)
         VALUES ($1, $2, $3, 'active', $4, $5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [
          demo.email,
          demo.name,
          passwordHash,
          `GDEMO${randomBytes(24).toString('hex').toUpperCase().slice(0, 51)}`,
          Math.floor(Math.random() * 1_000_000) + 1,
        ],
      );
      const merchantId = merchantRes.rows[0].id;
      console.log(`✅ Merchant: ${demo.name} (${merchantId})`);

      // Create 3 demo invoices
      for (let i = 1; i <= 3; i++) {
        const amountUsdc = (10 * i).toFixed(7);
        const feeBps = 50;
        const feeUsdc = ((10 * i * feeBps) / 10000).toFixed(7);
        const netUsdc = (10 * i - parseFloat(feeUsdc)).toFixed(7);
        const muxedId = Date.now() + Math.floor(Math.random() * 1_000_000);
        const status = i === 1 ? 'paid' : i === 2 ? 'pending' : 'expired';
        const expiresAt = new Date(Date.now() + (status === 'expired' ? -3600000 : 3600000));

        await pool.query(
          `INSERT INTO invoices
             (merchant_id, amount_usdc, gross_usdc, fee_usdc, net_usdc, description, status, muxed_id, muxed_address, memo, expires_at, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (muxed_id) DO NOTHING`,
          [
            merchantId,
            amountUsdc,
            amountUsdc,
            feeUsdc,
            netUsdc,
            `Demo invoice #${i} for ${demo.name}`,
            status,
            muxedId,
            `MDEMO${muxedId}`,
            `INV-${muxedId}`,
            expiresAt.toISOString(),
            status === 'paid' ? new Date().toISOString() : null,
          ],
        );
        console.log(`   📄 Invoice #${i}: ${amountUsdc} USDC [${status}]`);
      }

      // Create a demo webhook
      const secret = `whsec_${randomBytes(32).toString('hex')}`;
      const webhookRes = await pool.query<{ id: string }>(
        `INSERT INTO webhooks (merchant_id, url, events, secret, active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [merchantId, 'https://webhook.site/demo', WEBHOOK_EVENTS, secret],
      );
      if (webhookRes.rows[0]) {
        console.log(`   🔔 Webhook: ${webhookRes.rows[0].id} (secret: ${secret.slice(0, 16)}...)`);
      }

      console.log();
    }

    console.log('✅ Seed complete.');
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
