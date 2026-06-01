import { RolesGuard } from '../../src/auth/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '../../src/auth/roles.enum';

function makeCtx(userRole?: Role) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user: userRole ? { role: userRole } : {} }) }),
  } as any;
}

describe('RolesGuard', () => {
  it('denies access when user role is insufficient', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER, Role.ADMIN]) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(makeCtx(Role.VIEWER))).toThrow(ForbiddenException);
  });

  it('allows access for admin role', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.OWNER, Role.ADMIN]) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(makeCtx(Role.ADMIN))).toBe(true);
  });
});
