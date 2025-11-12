// src/email/services/retry.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../shared/redis.service';

interface RetryMetadata {
  request_id: string;
  attempt_count: number;
  first_attempt_at: Date;
  last_attempt_at: Date;
  next_retry_at: Date;
  errors: string[];
}

@Injectable()
export class RetryService {
  private readonly logger = new Logger(RetryService.name);
  // Retry configuration
  private readonly INITIAL_DELAY_MS = 1000; // 1 second
  private readonly MAX_DELAY_MS = 300000; // 5 minutes
  private readonly BACKOFF_MULTIPLIER = 2;
  private readonly MAX_ATTEMPTS = 3;

  constructor(private readonly redisService: RedisService) {}

  async getRetryCount(request_id: string): Promise<number> {
    const key = `retry:${request_id}`;
    const metadata = await this.redisService.get(key);

    if (!metadata) {
      return 0;
    }

    const retryData = JSON.parse(metadata) as RetryMetadata;
    return retryData.attempt_count;
  }

  async recordRetry(request_id: string, error: string): Promise<void> {
    const key = `retry:${request_id}`;
    const existing = await this.redisService.get(key);

    let retryData: RetryMetadata;
    const now = new Date();

    if (existing) {
      retryData = JSON.parse(existing) as RetryMetadata;
      retryData.attempt_count++;
      retryData.last_attempt_at = now;
      retryData.errors.push(error);
    } else {
      retryData = {
        request_id,
        attempt_count: 1,
        first_attempt_at: now,
        last_attempt_at: now,
        next_retry_at: now,
        errors: [error],
      };
    }

    // Calculate next retry time with exponential backoff
    const delay = this.calculateBackoff(retryData.attempt_count);
    retryData.next_retry_at = new Date(Date.now() + delay);

    // Store for 24 hours
    await this.redisService.set(key, JSON.stringify(retryData), 86400);

    this.logger.log(
      `📝 Retry recorded for ${request_id}: Attempt ${retryData.attempt_count}/${this.MAX_ATTEMPTS}. Next retry: ${delay}ms`,
    );
  }

  async shouldRetry(request_id: string): Promise<boolean> {
    const count = await this.getRetryCount(request_id);
    const shouldRetry = count < this.MAX_ATTEMPTS;

    if (!shouldRetry) {
      this.logger.warn(
        `🚫 Max retry attempts (${this.MAX_ATTEMPTS}) reached for ${request_id}`,
      );
    }

    return shouldRetry;
  }

  async getRetryMetadata(request_id: string): Promise<RetryMetadata | null> {
    const key = `retry:${request_id}`;
    const data = await this.redisService.get(key);

    if (!data) {
      return null;
    }

    return JSON.parse(data) as RetryMetadata;
  }

  async clearRetry(request_id: string): Promise<void> {
    const key = `retry:${request_id}`;
    await this.redisService.del(key);
    this.logger.log(`🗑️ Retry metadata cleared for ${request_id}`);
  }

  private calculateBackoff(attempt_count: number): number {
    // Exponential backoff: delay = initial_delay * (multiplier ^ (attempt - 1))
    const delay = Math.min(
      this.INITIAL_DELAY_MS *
        Math.pow(this.BACKOFF_MULTIPLIER, attempt_count - 1),
      this.MAX_DELAY_MS,
    );

    // Add jitter (random 0-20% variation) to prevent thundering herd
    const jitter = delay * 0.2 * Math.random();
    return Math.floor(delay + jitter);
  }

  getRetryConfig() {
    return {
      initial_delay_ms: this.INITIAL_DELAY_MS,
      max_delay_ms: this.MAX_DELAY_MS,
      backoff_multiplier: this.BACKOFF_MULTIPLIER,
      max_attempts: this.MAX_ATTEMPTS,
    };
  }
}
