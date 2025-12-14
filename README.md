API Gateway – Distributed Notification System (Stage 4 Task)
    Overview

The API Gateway is the main entry point of the Distributed Notification System.
Its responsibilities:

Accept all incoming notification requests

Validate and authenticate requests

Enforce idempotency using Redis

Publish messages to RabbitMQ queues (email.queue or push.queue)

Return standardized API responses

Provide health checks and service readiness information

This service works together with:

User Service

Template Service

Email Service

Push Service

 Features
    Notification Request Endpoint

    Accepts email or push notification requests and routes them to RabbitMQ.

 dempotency

    Uses Redis to prevent duplicate processing using request_id.

    Asynchronous Messaging

    Gateway returns instantly while workers process notifications in the background.

Standardized Response Format

Follows the task requirement:

{
  "success": true,
  "data": {},
  "message": "",
  "meta": {}
}

Dockerized

Fully containerized using Docker Compose (RabbitMQ + Redis + API Gateway).


Environment Variables

Create a .env file in the root directory:

PORT=3000

RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
RABBITMQ_EXCHANGE=notification.direct

REDIS_URL=redis://redis:6379


Make sure NOT to commit real secrets.

Running the Service
1. Start Docker
docker compose up --build


This will start:

API Gateway

RabbitMQ

Redis

2. Check RabbitMQ Dashboard

RabbitMQ UI URL:
http://localhost:15672

Login:

Username: guest

Password: guest

Testing the Notification Endpoint
POST /api/v1/notifications

Sample body:

{
  "notification_type": "email",
  "user_id": "a12f98a3-7f1b-4eac-8fee-8fe1daca9911",
  "template_code": "welcome_template",
  "variables": {
    "name": "John",
    "link": "https://example.com/verify"
  },
  "request_id": "req-001",
  "priority": 1,
  "metadata": {}
}

Success Response (202)
{
  "success": true,
  "data": {
    "request_id": "req-001"
  },
  "message": "notification_request_received",
  "meta": {
    "total": 0,
    "limit": 0,
    "page": 0,
    "total_pages": 0,
    "has_next": false,
    "has_previous": false
  }
}

Duplicate Request Response
{
  "success": false,
  "error": "duplicate_request",
  "message": "request_id has already been processed",
  "meta": {}
}

Health Check
GET /health

Response:

{
  "status": "ok",
  "timestamp": "2025-11-14T12:00:00Z"
}

📡 Architecture Flow

Client sends POST request

API Gateway validates and checks Redis for idempotency

Publishes message to RabbitMQ exchange

Email/Push service consumes message

Client receives immediate 202 Accepted response

 Docker Compose

Includes:

api-gateway

rabbitmq

redis

Everything is automatically networked inside Docker.

Useful Commands
Stop all services
docker compose down

View logs
docker compose logs -f

 Status

The API Gateway is fully functional and ready for integration with:

Email Service

Push Service

Template Service