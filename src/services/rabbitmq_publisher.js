const amqp = require('amqplib');

let channel;
const exchange = process.env.RABBITMQ_EXCHANGE || 'notifications.direct';

async function initRabbit() {
  const url = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
  const conn = await amqp.connect(url);
  channel = await conn.createChannel();
  await channel.assertExchange(exchange, 'direct', { durable: true });

  await channel.assertQueue('email.queue', { durable: true });
  await channel.assertQueue('push.queue', { durable: true });
  await channel.assertQueue('failed.queue', { durable: true });

  await channel.bindQueue('email.queue', exchange, 'email.queue');
  await channel.bindQueue('push.queue', exchange, 'push.queue');

  console.log('✅ Connected to RabbitMQ');
}

async function publishNotification({ routingKey, payload }) {
  if (!channel) throw new Error('RabbitMQ not initialized');
  const message = {
    request_id: payload.request_id,
    user_id: payload.user_id,
    template_code: payload.template_code,
    variables: payload.variables,
    priority: payload.priority,
    metadata: payload.metadata || {},
    timestamp: new Date().toISOString()
  };
  const buffer = Buffer.from(JSON.stringify(message));
  channel.publish(exchange, routingKey, buffer, { persistent: true });
  console.log(`📤 Sent message to ${routingKey}`);
}

module.exports = { initRabbit, publishNotification };
