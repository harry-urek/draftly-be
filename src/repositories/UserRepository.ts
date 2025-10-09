/* eslint-disable import/no-unresolved */
import { PrismaClient, Prisma, User as PrismaUser } from "@prisma/client";

import type {
  User,
  AuthTokens,
  OnboardingStatus,
  AIStyleProfile,
} from "../types/index.js";
import { tryEncrypt, tryDecrypt } from "../utils/encryption.js";

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
    if (!userData.firebaseUid || !userData.email) {
      throw new Error("firebaseUid and email are required to create a user");
    }

    const user = await this.prisma.user.create({
      data: {
        firebaseUid: userData.firebaseUid,
        email: userData.email,
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
    await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { firebaseUid },
        select: { id: true },
      });

      if (!user) {
        return;
      }

      const userId = user.id;

      await tx.draft.deleteMany({ where: { userId } });
      await tx.email.deleteMany({ where: { userId } });
      await tx.thread.deleteMany({ where: { userId } });
    });
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
    status: OnboardingStatus
  ): Promise<void> {
    await this.prisma.user.update({
      where: { firebaseUid },
      data: { onboardingStatus: status },
    });
  }

  async storeStyleProfile(
    firebaseUid: string,
    profile: unknown
  ): Promise<void> {
    await this.prisma.user.update({
      where: { firebaseUid },
      data: { aiStyleProfile: profile as Prisma.JsonValue },
    });
  }

  async getStyleProfile(firebaseUid: string): Promise<AIStyleProfile | null> {
    const user = await this.prisma.user.findUnique({
      where: { firebaseUid },
      select: { aiStyleProfile: true },
    });
    return (user?.aiStyleProfile as AIStyleProfile | null) || null;
  }

  private mapToUser(dbUser: PrismaUser): User {
    return {
      id: dbUser.id,
      firebaseUid: dbUser.firebaseUid,
      email: dbUser.email,
      name: dbUser.name ?? undefined,
      picture: dbUser.picture ?? undefined,
      onboardingStatus: dbUser.onboardingStatus,
      createdAt: new Date(dbUser.createdAt),
      updatedAt: new Date(dbUser.updatedAt),
      lastActive: new Date(dbUser.lastActive),
      isOnline: dbUser.isOnline,
    };
  }
}
