# Email Service - Distributed Notification System

A robust, scalable email notification microservice built with NestJS and TypeScript. Part of a distributed notification system that processes email notifications asynchronously through RabbitMQ message queues.

## 🎯 Features

- **Asynchronous Message Processing**: Consumes messages from RabbitMQ email queue
- **Circuit Breaker Pattern**: Prevents cascading failures when SMTP services are down
- **Exponential Backoff Retry**: Automatic retry with exponential backoff for failed emails
- **Idempotency**: Prevents duplicate email sends using unique request IDs
- **Template Rendering**: Dynamic email template rendering with variable substitution
- **Multiple Email Providers**: Support for SMTP, SendGrid, Mailgun, and Gmail
- **Redis Caching**: Caches user data and templates for improved performance
- **Health Checks**: Comprehensive health, readiness, and liveness endpoints
- **Dead Letter Queue**: Failed messages automatically moved to DLQ after max retries
- **Horizontal Scalability**: Stateless design allows multiple instances

## 🏗️ Architecture

```
RabbitMQ (email.queue)
        ↓
Email Service Consumer
        ↓
1. Check Idempotency (Redis)
2. Fetch User Data (User Service + Cache)
3. Fetch Template (Template Service + Cache)
4. Render Email Template
5. Send Email (with Circuit Breaker)
6. Update Status (Status Queue)
7. Mark as Processed (Redis)
```

## 📋 Prerequisites

- Node.js 20+
- Docker & Docker Compose
- RabbitMQ 3.12+
- Redis 7+
- SMTP credentials or email service API keys

## 🚀 Quick Start

### 1. Clone and Install

```bash
cd services/email-service
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
# Service
PORT=3002
NODE_ENV=development

# RabbitMQ
RABBITMQ_URL=amqp://localhost:5672

# Redis
REDIS_URL=redis://localhost:6379

# Email Provider (smtp, sendgrid, mailgun, gmail)
EMAIL_PROVIDER=smtp
EMAIL_FROM=noreply@notifications.com

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Service URLs
USER_SERVICE_URL=http://localhost:3001
TEMPLATE_SERVICE_URL=http://localhost:3004
```

### 3. Run with Docker Compose

```bash
docker-compose up -d
```

### 4. Run in Development Mode

```bash
npm run start:dev
```

## 📡 API Endpoints

### Health Check
```
GET /health
```

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-10T12:00:00Z",
  "service": "email-service",
  "dependencies": {
    "redis": { "status": "up" },
    "email_transporter": { "status": "up" },
    "rabbitmq": { "status": "connected" }
  },
  "circuit_breakers": [
    {
      "name": "email_send",
      "state": "CLOSED",
      "failure_count": 0
    }
  ]
}
```

### Readiness Check
```
GET /health/ready
```

### Liveness Check
```
GET /health/live
```

## 📨 Message Format

The service consumes messages from the `email.queue` with this format:

```typescript
{
  notification_type: "email",
  user_id: "550e8400-e29b-41d4-a716-446655440000",
  template_code: "welcome_email",
  variables: {
    name: "John Doe",
    link: "https://example.com/verify",
    meta: {}
  },
  request_id: "unique-request-id-123",
  priority: 1,
  metadata: {}
}
```

## 🔄 Retry Strategy

The service implements exponential backoff for failed deliveries:

- **Max Attempts**: 3
- **Initial Delay**: 1 second
- **Backoff Multiplier**: 2x
- **Max Delay**: 5 minutes
- **Jitter**: ±20% random variation

**Retry Schedule:**
- 1st retry: ~1 second
- 2nd retry: ~2 seconds
- 3rd retry: ~4 seconds
- After 3 failures → Dead Letter Queue

## 🛡️ Circuit Breaker

Protects against cascading failures when email providers are down:

- **Failure Threshold**: 5 consecutive failures
- **Success Threshold**: 2 successes to close circuit
- **Timeout**: 60 seconds before testing recovery
- **States**: CLOSED (normal) → OPEN (failing) → HALF_OPEN (testing)

## 🎯 Idempotency

Prevents duplicate email sends:

1. Check Redis for `processed:{request_id}`
2. If exists, return success immediately
3. If not, process and mark as processed
4. Cache for 24 hours

## 📊 Monitoring

### Key Metrics to Track

- Message processing rate
- Email delivery success rate
- Circuit breaker state changes
- Retry attempts per message
- Queue depth
- Service response times
- Error rates by type

### Logging

All logs include correlation IDs for request tracing:

```
[request-id-123] Starting email processing
[request-id-123] User fetched from cache
[request-id-123] Template rendered successfully
[request-id-123] ✅ Email delivered in 245ms
```

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run tests with coverage
npm run test:cov

# Run tests in watch mode
npm run test:watch
```

## 📦 Docker Deployment

### Build Image

```bash
docker build -t email-service:latest .
```

### Run Container

```bash
docker run -d \
  --name email-service \
  -p 3002:3002 \
  -e RABBITMQ_URL=amqp://rabbitmq:5672 \
  -e REDIS_URL=redis://redis:6379 \
  email-service:latest
```

## 🔧 Configuration

### Email Providers

#### SMTP
```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
```

#### SendGrid
```env
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your-api-key
```

#### Mailgun
```env
EMAIL_PROVIDER=mailgun
MAILGUN_USERNAME=your-username
MAILGUN_PASSWORD=your-password
```

#### Gmail
```env
EMAIL_PROVIDER=gmail
GMAIL_USER=your-gmail@gmail.com
GMAIL_APP_PASSWORD=your-app-password
```

## 📈 Scaling

The service is stateless and horizontally scalable:

```bash
# Run multiple instances
docker-compose up -d --scale email-service=3
```

Each instance will consume from the same queue with load balancing.

## 🐛 Troubleshooting

### Service not processing messages

1. Check RabbitMQ connection: `docker logs email-service | grep RabbitMQ`
2. Verify queue exists: Check RabbitMQ Management UI (http://localhost:15672)
3. Check circuit breaker state: `GET /health`

### Emails not being sent

1. Verify SMTP credentials
2. Check email provider logs
3. Review circuit breaker state
4. Check dead letter queue for failed messages

### High memory usage

1. Review Redis cache TTL settings
2. Check for memory leaks: `GET /health` (memory section)
3. Restart service if needed

## 📝 License

MIT

## 👥 Team

Developed as part of Stage 4 Backend Task - Distributed Notification System

---

**Service Status**: Production Ready ✅  
**Version**: 1.0.0  
**Last Updated**: November 2025