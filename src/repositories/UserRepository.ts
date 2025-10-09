import { PrismaClient } from "@prisma/client";

import { User, AuthTokens } from "../types";
import { tryEncrypt, tryDecrypt } from "../utils/encryption";

export class UserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });
    return user ? this.mapToUser(user) : null;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
    });
    return user ? this.mapToUser(user) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });
    return user ? this.mapToUser(user) : null;
  }

  async create(userData: Partial<User>): Promise<User> {
    const user = await this.prisma.user.create({
      data: {
        firebaseUid: userData.firebaseUid!,
        email: userData.email!,
        name: userData.name,
        picture: userData.picture,
        lastActive: new Date(),
        isOnline: true,
        onboardingStatus: userData.onboardingStatus || "NOT_STARTED",
      },
    });
    return this.mapToUser(user);
  }

  async update(firebaseUid: string, updates: Partial<User>): Promise<User> {
    const user = await this.prisma.user.update({
      where: { firebaseUid },
      data: {
        ...updates,
        updatedAt: new Date(),
      },
    });
    return this.mapToUser(user);
  }

  async updateLastActive(firebaseUid: string): Promise<void> {
    await this.prisma.user.update({
      where: { firebaseUid },
      data: {
        lastActive: new Date(),
        isOnline: true,
      },
    });
  }

  async setOffline(firebaseUid: string): Promise<void> {
    await this.prisma.user.update({
      where: { firebaseUid },
      data: {
        isOnline: false,
      },
    });
  }

  async clearTokens(firebaseUid: string): Promise<void> {
    await this.prisma.user.update({
      where: { firebaseUid },
      data: {
        accessToken: null,
        refreshToken: null,
      },
    });
  }

  async purgeUserData(firebaseUid: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: { id: true },
    });
    if (!user) return;
    const userId = user.id;
    await this.prisma.draft.deleteMany({ where: { userId } });
    await this.prisma.email.deleteMany({ where: { userId } });
    await this.prisma.thread.deleteMany({ where: { userId } });
  }

  async storeTokens(firebaseUid: string, tokens: AuthTokens): Promise<void> {
    const updateData: Record<string, string | Date | boolean | undefined> = {};

    if (tokens.accessToken) {
      updateData.accessToken = tryEncrypt(tokens.accessToken);
    }

    if (tokens.refreshToken) {
      updateData.refreshToken = tryEncrypt(tokens.refreshToken);
    }

    // Refresh lastActive and mark user online when we store tokens
    updateData.lastActive = new Date();
    updateData.isOnline = true;

    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { firebaseUid },
        data: updateData,
      });
    }
  }

  async getTokens(firebaseUid: string): Promise<AuthTokens | null> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: {
        accessToken: true,
        refreshToken: true,
      },
    });

    if (!user) return null;

    return {
      accessToken: tryDecrypt(user.accessToken ?? undefined),
      refreshToken: tryDecrypt(user.refreshToken ?? undefined),
    };
  }

  async updateOnboardingStatus(
    firebaseUid: string,
    status: string
  ): Promise<void> {
    await this.prisma.user.update({
      where: { firebaseUid },
      data: { onboardingStatus: status as any },
    });
  }

  async storeStyleProfile(firebaseUid: string, profile: any): Promise<void> {
    await this.prisma.user.update({
      where: { firebaseUid },
      data: { aiStyleProfile: profile },
    });
  }

  async getStyleProfile(firebaseUid: string): Promise<any | null> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: { aiStyleProfile: true },
    });
    return user?.aiStyleProfile || null;
  }

  private mapToUser(dbUser: any): User {
    return {
      id: dbUser.id,
      firebaseUid: dbUser.firebaseUid,
      email: dbUser.email,
      name: dbUser.name,
      picture: dbUser.picture,
      onboardingStatus: dbUser.onboardingStatus,
      createdAt: new Date(dbUser.createdAt),
      updatedAt: new Date(dbUser.updatedAt),
      lastActive: new Date(dbUser.lastActive),
      isOnline: dbUser.isOnline,
    };
  }
}
