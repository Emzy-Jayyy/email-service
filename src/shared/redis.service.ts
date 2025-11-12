// src/shared/redis.service.ts
import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: RedisClientType;

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: (retries: number) => {
            if (retries > 10) {
              this.logger.error('❌ Max Redis reconnection attempts reached');
              return new Error('Max reconnection attempts reached');
            }
            const delay = Math.min(retries * 100, 3000);
            this.logger.warn(`🔄 Reconnecting to Redis in ${delay}ms...`);
            return delay;
          },
        },
      }) as RedisClientType;

      this.client.on('error', (err: Error) => {
        this.logger.error('Redis Client Error:', err);
      });

      this.client.on('connect', () => {
        this.logger.log('🔌 Connecting to Redis...');
      });

      this.client.on('ready', () => {
        this.logger.log('✅ Redis client ready');
      });

      await this.client.connect();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Failed to connect to Redis:', errorMessage);
      throw error;
    }
  }

  private async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      this.logger.log('👋 Redis connection closed');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Error disconnecting from Redis:', errorMessage);
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      const result = await this.client.get(key);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting key ${key}:`, errorMessage);
      return null;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setEx(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error setting key ${key}:`, errorMessage);
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error deleting key ${key}:`, errorMessage);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error checking existence of key ${key}:`,
        errorMessage,
      );
      return false;
    }
  }

  async incr(key: string): Promise<number> {
    try {
      return await this.client.incr(key);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error incrementing key ${key}:`, errorMessage);
      throw error;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error setting expiry for key ${key}:`, errorMessage);
    }
  }

  async keys(pattern: string): Promise<string[]> {
    try {
      const result = await this.client.keys(pattern);
      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error getting keys with pattern ${pattern}:`,
        errorMessage,
      );
      return [];
    }
  }

  getClient(): RedisClientType {
    return this.client;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Redis health check failed:', errorMessage);
      return false;
    }
  }
}
