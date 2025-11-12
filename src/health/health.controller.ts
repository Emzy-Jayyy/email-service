// src/health/health.controller.ts
import { Controller, Get, Logger } from '@nestjs/common';
import { RedisService } from '../shared/redis.service';
import { EmailSender } from '../email/services/email-sender.service';
import {
  CircuitBreakerService,
  CircuitState,
} from '../email/services/circuit-breaker.service';

interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  service: string;
  version?: string;
  dependencies?: {
    redis: {
      status: 'up' | 'down';
    };
    email_transporter: {
      status: 'up' | 'down';
    };
    rabbitmq: {
      status: string;
    };
  };
  circuit_breakers?: Array<{
    name: string;
    state: CircuitState;
    failure_count: number;
  }>;
  uptime?: number;
  memory?: {
    used: number;
    total: number;
    unit: string;
  };
  error?: string;
}

interface ReadinessResponse {
  status: 'ready' | 'not_ready';
  message?: string;
  error?: string;
}

interface LivenessResponse {
  status: 'alive';
  timestamp: string;
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly emailSender: EmailSender,
    private readonly circuitBreaker: CircuitBreakerService,
  ) {}

  @Get()
  async getHealth(): Promise<HealthResponse> {
    const timestamp = new Date().toISOString();

    try {
      // Check Redis connection
      const redisHealthy = await this.redisService.healthCheck();

      // Check Email transporter
      const emailHealthy = await this.emailSender.verifyConnection();

      // Get circuit breaker status
      const circuits = this.circuitBreaker.getAllCircuits();
      const circuitStatus = Array.from(circuits.entries()).map(
        ([name, circuit]) => ({
          name,
          state: circuit.state,
          failure_count: circuit.failure_count,
        }),
      );

      const isHealthy = redisHealthy && emailHealthy;

      return {
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp,
        service: 'email-service',
        version: process.env.npm_package_version || '1.0.0',
        dependencies: {
          redis: {
            status: redisHealthy ? 'up' : 'down',
          },
          email_transporter: {
            status: emailHealthy ? 'up' : 'down',
          },
          rabbitmq: {
            status: 'connected', // Assume connected if service is running
          },
        },
        circuit_breakers: circuitStatus,
        uptime: process.uptime(),
        memory: {
          used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          unit: 'MB',
        },
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        timestamp,
        service: 'email-service',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('ready')
  async getReadiness(): Promise<ReadinessResponse> {
    // Readiness check - is the service ready to accept traffic?
    try {
      const redisHealthy = await this.redisService.healthCheck();
      if (!redisHealthy) {
        return {
          status: 'not_ready',
          message: 'Redis connection not available',
        };
      }

      return {
        status: 'ready',
        message: 'Service is ready to accept traffic',
      };
    } catch (error) {
      return {
        status: 'not_ready',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  @Get('live')
  getLiveness(): LivenessResponse {
    // Liveness check - is the service alive?
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }
}
