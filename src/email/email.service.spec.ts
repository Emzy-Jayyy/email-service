// src/email/email.service.spec.ts
import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from './email.service';
import { EmailSender } from './services/email-sender.service';
import { TemplateService } from './services/template.service';
import { UserService } from './services/user.service';
import { RetryService } from './services/retry.service';
import { RedisService } from '../shared/redis.service';
import { ClientProxy } from '@nestjs/microservices';
import { NotificationStatus } from './types';

describe('EmailService', () => {
  let service: EmailService;
  let emailSender: EmailSender;
  let templateService: TemplateService;
  let userService: UserService;
  let retryService: RetryService;
  let redisService: RedisService;
  let statusClient: ClientProxy;

  const mockPayload = {
    notification_type: 'email' as const,
    user_id: '123e4567-e89b-12d3-a456-426614174000',
    template_code: 'welcome_email',
    variables: {
      name: 'John Doe',
      link: 'https://example.com',
    },
    request_id: 'test-request-123',
    priority: 1,
  };

  const mockUser = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'John Doe',
    email: 'john@example.com',
    preferences: {
      email: true,
      push: false,
    },
  };

  const mockTemplate = {
    id: '1',
    code: 'welcome_email',
    subject: 'Welcome {{name}}!',
    html_body: '<h1>Hello {{name}}</h1><p>Click <a href="{{link}}">here</a></p>',
    variables: ['name', 'link'],
    language: 'en',
    version: 1,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: EmailSender,
          useValue: {
            sendEmail: jest.fn(),
          },
        },
        {
          provide: TemplateService,
          useValue: {
            getTemplate: jest.fn(),
            renderTemplate: jest.fn(),
          },
        },
        {
          provide: UserService,
          useValue: {
            getUserById: jest.fn(),
          },
        },
        {
          provide: RetryService,
          useValue: {
            getRetryCount: jest.fn(),
            recordRetry: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
        {
          provide: 'STATUS_SERVICE',
          useValue: {
            emit: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    emailSender = module.get<EmailSender>(EmailSender);
    templateService = module.get<TemplateService>(TemplateService);
    userService = module.get<UserService>(UserService);
    retryService = module.get<RetryService>(RetryService);
    redisService = module.get<RedisService>(RedisService);
    statusClient = module.get<ClientProxy>('STATUS_SERVICE');
  });

  describe('processEmailNotification', () => {
    it('should successfully process and send email', async () => {
      // Arrange
      jest.spyOn(redisService, 'get').mockResolvedValue(null); // Not processed before
      jest.spyOn(userService, 'getUserById').mockResolvedValue(mockUser);
      jest.spyOn(templateService, 'getTemplate').mockResolvedValue(mockTemplate);
      jest.spyOn(templateService, 'renderTemplate').mockReturnValue({
        subject: 'Welcome John Doe!',
        html_body: '<h1>Hello John Doe</h1><p>Click <a href="https://example.com">here</a></p>',
      });
      jest.spyOn(emailSender, 'sendEmail').mockResolvedValue({
        success: true,
        message_id: 'msg-123',
        timestamp: new Date(),
      });
      jest.spyOn(redisService, 'set').mockResolvedValue(undefined);
      jest.spyOn(statusClient, 'emit').mockReturnValue(undefined as any);

      // Act
      const result = await service.processEmailNotification(mockPayload);

      // Assert
      expect(result.success).toBe(true);
      expect(emailSender.sendEmail).toHaveBeenCalledWith({
        to: 'john@example.com',
        subject: 'Welcome John Doe!',
        html: '<h1>Hello John Doe</h1><p>Click <a href="https://example.com">here</a></p>',
        text: undefined,
        correlationId: 'test-request-123',
      });
      expect(statusClient.emit).toHaveBeenCalledWith(
        'email.status',
        expect.objectContaining({
          notification_id: 'test-request-123',
          status: NotificationStatus.DELIVERED,
        }),
      );
    });

    it('should return early if request already processed (idempotent)', async () => {
      // Arrange
      jest.spyOn(redisService, 'get').mockResolvedValue(
        JSON.stringify({ success: true, message_id: 'old-msg' }),
      );

      // Act
      const result = await service.processEmailNotification(mockPayload);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message_id).toBe('duplicate');
      expect(userService.getUserById).not.toHaveBeenCalled();
      expect(emailSender.sendEmail).not.toHaveBeenCalled();
    });

    it('should fail if user not found', async () => {
      // Arrange
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(userService, 'getUserById').mockResolvedValue(null);
      jest.spyOn(statusClient, 'emit').mockReturnValue(undefined as any);

      // Act
      const result = await service.processEmailNotification(mockPayload);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('User not found');
      expect(emailSender.sendEmail).not.toHaveBeenCalled();
    });

    it('should fail if user has email disabled', async () => {
      // Arrange
      const userWithDisabledEmail = {
        ...mockUser,
        preferences: { email: false, push: false },
      };
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(userService, 'getUserById').mockResolvedValue(userWithDisabledEmail);
      jest.spyOn(statusClient, 'emit').mockReturnValue(undefined as any);

      // Act
      const result = await service.processEmailNotification(mockPayload);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('User preferences disabled');
      expect(emailSender.sendEmail).not.toHaveBeenCalled();
    });

    it('should handle email send failure', async () => {
      // Arrange
      jest.spyOn(redisService, 'get').mockResolvedValue(null);
      jest.spyOn(userService, 'getUserById').mockResolvedValue(mockUser);
      jest.spyOn(templateService, 'getTemplate').mockResolvedValue(mockTemplate);
      jest.spyOn(templateService, 'renderTemplate').mockReturnValue({
        subject: 'Welcome John Doe!',
        html_body: '<h1>Hello John Doe</h1>',
      });
      jest.spyOn(emailSender, 'sendEmail').mockResolvedValue({
        success: false,
        error: 'SMTP connection failed',
        timestamp: new Date(),
      });
      jest.spyOn(statusClient, 'emit').mockReturnValue(undefined as any);

      // Act
      const result = await service.processEmailNotification(mockPayload);

      // Assert
      expect(result.success).toBe(false);
      expect(statusClient.emit).toHaveBeenCalledWith(
        'email.status',
        expect.objectContaining({
          status: NotificationStatus.FAILED,
          error: 'SMTP connection failed',
        }),
      );
    });
  });

  describe('shouldRetry', () => {
    it('should return true if retry count is below max', async () => {
      jest.spyOn(retryService, 'getRetryCount').mockResolvedValue(2);

      const result = await service.shouldRetry(mockPayload);

      expect(result).toBe(true);
    });

    it('should return false if retry count reached max', async () => {
      jest.spyOn(retryService, 'getRetryCount').mockResolvedValue(3);

      const result = await service.shouldRetry(mockPayload);

      expect(result).toBe(false);
    });
  });
});