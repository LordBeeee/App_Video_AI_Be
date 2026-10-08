import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roleIds: number[]) => SetMetadata(ROLES_KEY, roleIds);
