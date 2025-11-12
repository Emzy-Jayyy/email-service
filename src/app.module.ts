import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { HttpModule } from '@nestjs/axios';
import { EmailController } from './email/email.controller';
import { EmailService } from './email/email.service';
import { EmailSender } from './email/services/email-sender.service';
import { TemplateService } from './email/services/template.service';
import { UserService } from './email/services/user.service';
import { RetryService } from './email/services/retry.service';
import { CircuitBreakerService } from './email/services/circuit-breaker.service';
import { RedisService } from './shared/redis.service';
// import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HttpModule,
    ClientsModule.register([
      {
        name: 'STATUS_SERVICE',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
          queue: 'status.queue',
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
  ],
  controllers: [
    EmailController,
  ],
  providers: [
    EmailService,
    EmailSender,
    TemplateService,
    UserService,
    RetryService,
    CircuitBreakerService,
    RedisService,
  ],
})
export class AppModule {}
