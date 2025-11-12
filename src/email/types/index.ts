// src/email/types/index.ts

export enum NotificationStatus {
  DELIVERED = 'delivered',
  PENDING = 'pending',
  FAILED = 'failed',
}

export interface EmailNotificationPayload {
  notification_type: 'email';
  user_id: string;
  template_code: string;
  variables: Record<string, string | number | boolean>;
  request_id: string;
  priority: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface UserData {
  id: string;
  name: string;
  email: string;
  preferences: {
    email: boolean;
    push: boolean;
  };
}

export interface EmailTemplate {
  id: string;
  code: string;
  subject: string;
  html_body: string;
  text_body?: string;
  variables: string[];
  language: string;
  version: number;
}

export interface StatusUpdate {
  notification_id: string;
  status: NotificationStatus;
  timestamp: Date;
  error?: string;
  metadata?: Record<string, any>;
}

export interface EmailSendResult {
  success: boolean;
  message_id?: string;
  error?: string;
  timestamp: Date;
}

export interface RetryConfig {
  max_attempts: number;
  initial_delay_ms: number;
  max_delay_ms: number;
  backoff_multiplier: number;
}

// Idempotency tracking
export interface ProcessedRequest {
  request_id: string;
  status: NotificationStatus;
  processed_at: Date;
  result?: EmailSendResult;
}
