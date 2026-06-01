import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.module';

@Injectable()
export class TreasuryService {
  constructor(@Inject(DATABASE_POOL) private readonly pool: Pool) {}

  async setSigningQuorum(signingQuorum: number) {
    if (!Number.isInteger(signingQuorum) || signingQuorum < 1) {
      throw new BadRequestException('signingQuorum must be a positive integer');
    }

    const result = await this.pool.query(
      `INSERT INTO treasury_configuration (id, signing_quorum)
       VALUES ('default', $1)
       ON CONFLICT (id)
       DO UPDATE SET signing_quorum = EXCLUDED.signing_quorum, updated_at = NOW()
       RETURNING signing_quorum`,
      [signingQuorum],
    );

    return { signingQuorum: result.rows[0].signing_quorum as number };
  }
}
