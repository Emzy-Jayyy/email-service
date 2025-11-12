// src/email/services/user.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { UserData } from '../types';
import { RedisService } from '../../shared/redis.service';
import { AxiosError } from 'axios';

interface UserApiResponse {
  data: UserData;
}

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);
  private readonly USER_SERVICE_URL =
    process.env.USER_SERVICE_URL || 'http://localhost:3001';
  private readonly CACHE_TTL = 1800; // Cache user data for 30 minutes

  constructor(
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
  ) {}

  async getUserById(user_id: string): Promise<UserData | null> {
    const cacheKey = `user:${user_id}`;

    try {
      // Try cache first
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        this.logger.log(`📦 User found in cache: ${user_id}`);
        return JSON.parse(cached) as UserData;
      }

      // Fetch from User Service
      this.logger.log(`🔍 Fetching user from service: ${user_id}`);
      const response = await firstValueFrom(
        this.httpService.get<UserApiResponse>(
          `${this.USER_SERVICE_URL}/api/v1/users/${user_id}`,
          {
            timeout: 5000,
            headers: {
              'X-Service': 'email-service',
            },
          },
        ),
      );

      const user: UserData = response.data.data;

      // Cache the user data
      await this.redisService.set(
        cacheKey,
        JSON.stringify(user),
        this.CACHE_TTL,
      );

      return user;
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 404) {
          this.logger.warn(`User not found: ${user_id}`);
          return null;
        }
        this.logger.error(`Failed to fetch user ${user_id}:`, error.message);
      } else {
        // Handle non-Axios errors
        this.logger.error(
          `Failed to fetch user ${user_id}:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
      }
      throw error;
    }
  }

  async getUsersByIds(user_ids: string[]): Promise<Map<string, UserData>> {
    const users = new Map<string, UserData>();

    // Batch fetch users (in parallel)
    const promises = user_ids.map(async (user_id) => {
      const user = await this.getUserById(user_id);
      if (user) {
        users.set(user_id, user);
      }
    });

    await Promise.all(promises);

    return users;
  }

  async invalidateCache(user_id: string): Promise<void> {
    const cacheKey = `user:${user_id}`;
    await this.redisService.del(cacheKey);
    this.logger.log(`🗑️ User cache invalidated: ${user_id}`);
  }
}
