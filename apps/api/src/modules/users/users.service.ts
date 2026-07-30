import { Injectable, NotFoundException } from '@nestjs/common';
import type { PublicUser } from '@atlas/shared';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /** The self-view of an account. Never used to describe someone else. */
  async getPublicUser(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        phone: true,
        province: true,
        city: true,
        createdAt: true,
        dealership: { select: { id: true, name: true, verified: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      phone: user.phone,
      province: user.province,
      city: user.city,
      dealership: user.dealership,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
