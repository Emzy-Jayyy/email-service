// src/email/email.controller.ts
import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, Payload, RmqContext } from '@nestjs/microservices';
import { EmailService } from './email.service';
import * as types from './types';
import { RmqChannel, RmqMessage } from './rabbitmq.types';

@Controller()
export class EmailController {
  private readonly logger = new Logger(EmailController.name);

  constructor(private readonly emailService: EmailService) {}

  @EventPattern('email')
  async handleEmailNotification(
    @Payload() payload: types.EmailNotificationPayload,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef() as RmqChannel;
    const originalMessage = context.getMessage() as RmqMessage;

    this.logger.log(`📧 Received email notification: ${payload.request_id}`);

    try {
      // Process the email notification
      const result = await this.emailService.processEmailNotification(payload);

      if (result.success) {
        // Acknowledge the message
        channel.ack(originalMessage);
        this.logger.log(`✅ Email sent successfully: ${payload.request_id}`);
      } else {
        // Check if we should retry or send to DLQ
        const shouldRetry = await this.emailService.shouldRetry(payload);

        if (shouldRetry) {
          // Negative acknowledge - will be requeued
          channel.nack(originalMessage, false, true);
          this.logger.warn(`🔄 Email will be retried: ${payload.request_id}`);
        } else {
          // Send to dead letter queue
          channel.nack(originalMessage, false, false);
          this.logger.error(`Email sent to DLQ: ${payload.request_id}`);
        }
      }
    } catch (error) {
      const errorStack = error instanceof Error ? error.stack : String(error);
      this.logger.error(
        `💥 Error processing email: ${payload.request_id}`,
        errorStack,
      );
      // On exception, send to DLQ
      channel.nack(originalMessage, false, false);
    }
  }
}
