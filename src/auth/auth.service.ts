import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import Redis from 'ioredis';
import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { MerchantsService } from '../merchants/merchants.service';
import { REDIS } from '../redis/redis.module';
import { hashPassword, verifyPassword } from './password';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1),
});
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

@Injectable()
export class AuthService {
  constructor(
    private readonly merchants: MerchantsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async register(input: unknown) {
    /**
     * Register a new merchant and return issued auth tokens.
     * @param input - registration payload (validated internally)
     */
    const dto = registerSchema.parse(input);
    const merchant = await this.merchants.create({
      email: dto.email,
      name: dto.name,
      passwordHash: await hashPassword(dto.password),
    });
    return this.issueTokens(merchant);
  }

  async login(input: unknown) {
    /**
     * Authenticate a merchant and return issued auth tokens.
     * @param input - login payload (validated internally)
     */
    const dto = loginSchema.parse(input);
    const merchant = await this.merchants.findByEmail(dto.email);
    if (!merchant || !(await verifyPassword(dto.password, merchant.password_hash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokens(merchant);
  }

  async refresh(refreshToken?: string) {
    /**
     * Refresh access tokens using a valid refresh token.
     * @param refreshToken - opaque refresh token string
     */
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const parsed = this.parseRefresh(refreshToken);
    const key = `refresh:${parsed.merchantId}:${parsed.tokenId}`;
    const stored = await this.redis.get(key);
    if (!stored || stored !== this.hashRefresh(refreshToken)) throw new UnauthorizedException('Invalid refresh token');
    await this.redis.del(key);
    const merchant = await this.merchants.findOne(parsed.merchantId);
    return this.issueTokens(merchant);
  }

  async logout(refreshToken?: string) {
    /**
     * Invalidate a refresh token (logout).
     * @param refreshToken - opaque refresh token string
     */
    if (!refreshToken) return;
    const parsed = this.parseRefresh(refreshToken);
    await this.redis.del(`refresh:${parsed.merchantId}:${parsed.tokenId}`);
  }

  private async issueTokens(merchant: any) {
    const accessToken = await this.signAccess(merchant);
    const tokenId = randomBytes(16).toString('hex');
    const refreshToken = `${merchant.id}.${tokenId}.${randomBytes(32).toString('hex')}`;
    await this.redis.set(`refresh:${merchant.id}:${tokenId}`, this.hashRefresh(refreshToken), 'EX', 7 * 24 * 60 * 60);
    return {
      refreshToken,
      publicResponse: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: this.accessTokenTtlSeconds(),
        merchant: {
          id: merchant.id,
          email: merchant.email,
          name: merchant.name,
          tier: merchant.tier,
        },
      },
    };
  }

  private signAccess(merchant: any) {
    return this.jwt.signAsync({
      sub: merchant.id,
      email: merchant.email,
      tier: merchant.tier,
      role: merchant.role ?? 'owner',
      merchantId: merchant.merchantId ?? merchant.id,
    });
  }

  async signTeamMemberAccess(member: { id: string; email: string; role: string; merchantId: string; tier: string }) {
    /**
     * Issue an access token for a team member.
     * @param member - team member identifying fields
     */
    return this.jwt.signAsync({
      sub: member.id,
      email: member.email,
      tier: member.tier,
      role: member.role,
      merchantId: member.merchantId,
    });
  }

  private accessTokenTtlSeconds() {
    const expiry = this.config.get<string>('JWT_EXPIRY', '15m');
    const match = /^(\d+)([smhd])?$/.exec(expiry);
    if (!match) return 900;
    const value = Number(match[1]);
    const unit = match[2] ?? 's';
    const multiplier = unit === 'd' ? 86_400 : unit === 'h' ? 3600 : unit === 'm' ? 60 : 1;
    return value * multiplier;
  }

  private hashRefresh(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseRefresh(token: string) {
    const [merchantId, tokenId] = token.split('.');
    if (!merchantId || !tokenId) throw new UnauthorizedException('Malformed refresh token');
    return { merchantId, tokenId };
  }
}
