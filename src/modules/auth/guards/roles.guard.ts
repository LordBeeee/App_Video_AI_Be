import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoleIds = this.reflector.getAllAndOverride<number[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoleIds) return true;

    // req.user đến từ JwtStrategy.validate() → { id, email, roleId }
    const { user } = context.switchToHttp().getRequest();

    if (!requiredRoleIds.includes(Number(user?.roleId))) {
      throw new ForbiddenException('Chỉ admin mới có quyền truy cập');
    }

    return true;
  }
}