import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

async function bootstrap() {
  const logger = new Logger('EmailService');
  const app = await NestFactory.create(AppModule);

  // Connect to RabbitMQ as microservice
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
      queue: 'email.queue',
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'notifications.dlx',
          'x-dead-letter-routing-key': 'failed.email',
        },
      },
      prefetchCount: parseInt(process.env.PREFETCH_COUNT || '10'),
      noAck: false,
    },
  });

  await app.startAllMicroservices();

  const port = process.env.PORT || 3002;
  await app.listen(port);

  logger.log(`🚀 Email Service running on port ${port}`);
  logger.log(
    `📧 Connected to RabbitMQ: ${process.env.RABBITMQ_URL || 'amqp://localhost:5672'}`,
  );
}

bootstrap().catch((error) => {
  const logger = new Logger('EmailService');
  logger.error('Failed to start application:', error);
  process.exit(1);
});
