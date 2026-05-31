import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeysService, ApiKeyScope } from './api-keys.service';

export const REQUIRED_SCOPE_KEY = 'requiredApiKeyScope';

export const RequireScope = (scope: ApiKeyScope) =>
  (target: object, key?: string | symbol, descriptor?: TypedPropertyDescriptor<any>) => {
    Reflect.defineMetadata(REQUIRED_SCOPE_KEY, scope, descriptor?.value ?? target);
    return descriptor ?? target;
  };

const SCOPE_RANK: Record<ApiKeyScope, number> = { read_only: 1, webhooks: 2, full_access: 3 };

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing API key');
    const raw = header.slice(7);
    if (!raw.startsWith('sk_')) throw new UnauthorizedException('Not an API key');

    // Prefer the left-most address in X-Forwarded-For when running behind a proxy,
    // falling back to the Express-resolved req.ip and then the raw socket address.
    const forwarded = req.headers['x-forwarded-for'] as string | undefined;
    const clientIp: string | undefined =
      forwarded?.split(',')[0]?.trim() ?? req.ip ?? req.socket?.remoteAddress;

    const { merchantId, scope } = await this.apiKeys.validate(raw, clientIp);
    req.user = { merchantId, scope, isApiKey: true };

    const required: ApiKeyScope | undefined = this.reflector.get(REQUIRED_SCOPE_KEY, context.getHandler());
    if (required && SCOPE_RANK[scope] < SCOPE_RANK[required]) {
      throw new UnauthorizedException(`API key scope '${scope}' insufficient; requires '${required}'`);
    }
    return true;
  }
}
