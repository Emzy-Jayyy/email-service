// src/email/email.service.ts
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  EmailNotificationPayload,
  NotificationStatus,
  EmailSendResult,
  StatusUpdate,
} from './types';
import { EmailSender } from './services/email-sender.service';
import { TemplateService } from './services/template.service';
import { UserService } from './services/user.service';
import { RetryService } from './services/retry.service';
import { RedisService } from '../shared/redis.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly MAX_RETRY_ATTEMPTS = 3;

  constructor(
    private readonly emailSender: EmailSender,
    private readonly templateService: TemplateService,
    private readonly userService: UserService,
    private readonly retryService: RetryService,
    private readonly redisService: RedisService,
    @Inject('STATUS_SERVICE') private readonly statusClient: ClientProxy,
  ) {}

  async processEmailNotification(
    payload: EmailNotificationPayload,
  ): Promise<EmailSendResult> {
    const correlationId = payload.request_id;
    const startTime = Date.now();

    this.logger.log(`[${correlationId}] Starting email processing`);

    try {
      // Step 1: Check idempotency - have we processed this before?
      const alreadyProcessed = await this.checkIdempotency(payload.request_id);
      if (alreadyProcessed) {
        this.logger.log(
          `[${correlationId}] Request already processed (idempotent)`,
        );
        return {
          success: true,
          message_id: 'duplicate',
          timestamp: new Date(),
        };
      }

      // Step 2: Update status to pending
      await this.updateStatus(payload.request_id, NotificationStatus.PENDING);

      // Step 3: Fetch user data
      const user = await this.userService.getUserById(payload.user_id);
      if (!user) {
        throw new Error(`User not found: ${payload.user_id}`);
      }

      // Check user preferences
      if (!user.preferences.email) {
        this.logger.log(
          `[${correlationId}] User has email notifications disabled`,
        );
        await this.updateStatus(
          payload.request_id,
          NotificationStatus.FAILED,
          'User has email notifications disabled',
        );
        return {
          success: false,
          error: 'User preferences disabled',
          timestamp: new Date(),
        };
      }

      // Step 4: Fetch and render template
      const template = await this.templateService.getTemplate(
        payload.template_code,
      );
      if (!template) {
        throw new Error(`Template not found: ${payload.template_code}`);
      }

      const renderedEmail = this.templateService.renderTemplate(template, {
        ...payload.variables,
        user_name: user.name,
      });

      // Step 5: Send email using circuit breaker pattern
      const result = await this.emailSender.sendEmail({
        to: user.email,
        subject: renderedEmail.subject,
        html: renderedEmail.html_body,
        text: renderedEmail.text_body,
        correlationId,
      });

      // Step 6: Update status based on result
      if (result.success) {
        await this.updateStatus(
          payload.request_id,
          NotificationStatus.DELIVERED,
        );
        await this.markAsProcessed(payload.request_id, result);

        const duration = Date.now() - startTime;
        this.logger.log(
          `[${correlationId}] ✅ Email delivered in ${duration}ms`,
        );
      } else {
        await this.updateStatus(
          payload.request_id,
          NotificationStatus.FAILED,
          result.error,
        );
      }

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[${correlationId}] Failed to process email:`,
        errorStack,
      );

      await this.updateStatus(
        payload.request_id,
        NotificationStatus.FAILED,
        errorMessage,
      );

      return {
        success: false,
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  async shouldRetry(payload: EmailNotificationPayload): Promise<boolean> {
    const retryCount = await this.retryService.getRetryCount(
      payload.request_id,
    );
    return retryCount < this.MAX_RETRY_ATTEMPTS;
  }

  private async checkIdempotency(request_id: string): Promise<boolean> {
    const key = `processed:${request_id}`;
    const exists = await this.redisService.get(key);
    return !!exists;
  }

  private async markAsProcessed(
    request_id: string,
    result: EmailSendResult,
  ): Promise<void> {
    const key = `processed:${request_id}`;
    // Store for 24 hours
    await this.redisService.set(key, JSON.stringify(result), 86400);
  }

  private async updateStatus(
    notification_id: string,
    status: NotificationStatus,
    error?: string,
  ): Promise<void> {
    const statusUpdate: StatusUpdate = {
      notification_id,
      status,
      timestamp: new Date(),
      error,
    };

    try {
      // Publish status update to status queue
      this.statusClient.emit('email.status', statusUpdate);

      // Also cache in Redis for quick lookups
      const cacheKey = `status:${notification_id}`;
      await this.redisService.set(cacheKey, JSON.stringify(statusUpdate), 3600);
    } catch (error) {
      this.logger.error(
        `Failed to update status for ${notification_id}:`,
        error,
      );
    }
  }
}
