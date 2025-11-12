// src/email/services/email-sender.service.ts
import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SentMessageInfo } from 'nodemailer';
import { CircuitBreakerService } from './circuit-breaker.service';
import { EmailSendResult } from '../types';

interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  text?: string;
  correlationId: string;
}

interface RetryableError {
  code?: string;
  message?: string;
}

@Injectable()
export class EmailSender {
  private readonly logger = new Logger(EmailSender.name);
  private transporter: nodemailer.Transporter<SentMessageInfo>;

  constructor(private readonly circuitBreaker: CircuitBreakerService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const provider = process.env.EMAIL_PROVIDER || 'smtp';

    switch (provider) {
      case 'sendgrid':
        this.transporter = nodemailer.createTransport({
          host: 'smtp.sendgrid.net',
          port: 587,
          auth: {
            user: 'apikey',
            pass: process.env.SENDGRID_API_KEY,
          },
        });
        break;

      case 'mailgun':
        this.transporter = nodemailer.createTransport({
          host: 'smtp.mailgun.org',
          port: 587,
          auth: {
            user: process.env.MAILGUN_USERNAME,
            pass: process.env.MAILGUN_PASSWORD,
          },
        });
        break;

      case 'gmail':
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.GMAIL_USER,
            pass: process.env.GMAIL_APP_PASSWORD,
          },
        });
        break;

      default: // SMTP
        this.transporter = nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'localhost',
          port: parseInt(process.env.SMTP_PORT || '587', 10),
          secure: process.env.SMTP_SECURE === 'true',
          auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
          },
        });
    }

    this.logger.log(`Email transporter initialized with provider: ${provider}`);
  }

  async sendEmail(payload: EmailPayload): Promise<EmailSendResult> {
    const { to, subject, html, text, correlationId } = payload;

    this.logger.log(`[${correlationId}] Attempting to send email to ${to}`);

    // Use circuit breaker to prevent cascading failures
    return this.circuitBreaker.execute(async () => {
      try {
        const info: SentMessageInfo = await this.transporter.sendMail({
          from: process.env.EMAIL_FROM || 'noreply@notifications.com',
          to,
          subject,
          html,
          text: text || this.stripHtml(html),
          headers: {
            'X-Correlation-ID': correlationId,
          },
        });

        this.logger.log(
          `[${correlationId}] Email sent successfully. MessageId: ${info.messageId}`,
        );

        return {
          success: true,
          message_id: info.messageId,
          timestamp: new Date(),
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[${correlationId}] Failed to send email:`,
          errorMessage,
        );

        // Determine if error is retryable
        const isRetryable = this.isRetryableError(error);
        return {
          success: false,
          error: `${errorMessage} (Retryable: ${isRetryable})`,
          timestamp: new Date(),
        };
      }
    }, 'email_send');
  }

  private isRetryableError(error: unknown): boolean {
    const retryableErrors = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ENOTFOUND',
      'ECONNREFUSED',
      'EHOSTUNREACH',
    ];

    if (this.isErrorWithCode(error)) {
      return (
        (error.code !== undefined && retryableErrors.includes(error.code)) ||
        error.message?.includes('timeout') ||
        error.message?.includes('rate limit') ||
        false
      );
    }

    return false;
  }

  private isErrorWithCode(error: unknown): error is RetryableError {
    return (
      typeof error === 'object' &&
      error !== null &&
      ('code' in error || 'message' in error)
    );
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').trim();
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('Email transporter verified successfully');
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error('Email transporter verification failed:', errorMessage);
      return false;
    }
  }
}
