const { publishNotification } = require('../services/rabbitmq_publisher');
const { isProcessedThenSet } = require('../plugins/idempotency');
const { successResponse, errorResponse } = require('../utils/response_format');

const schema = {
  body: {
    type: 'object',
    required: ['notification_type', 'user_id', 'template_code', 'variables', 'request_id', 'priority'],
    properties: {
      notification_type: { type: 'string', enum: ['email', 'push'] },
      user_id: { type: 'string' },
      template_code: { type: 'string' },
      variables: { type: 'object' },
      request_id: { type: 'string' },
      priority: { type: 'integer' },
      metadata: { type: ['object', 'null'] }
    }
  }
};

async function createNotification(req, reply) {
  const payload = req.body;

  try {
    const already = await isProcessedThenSet(payload.request_id, 86400);
    if (already) {
      return reply.code(200).send(successResponse({ request_id: payload.request_id }, 'duplicate_request'));
    }

    const routingKey = payload.notification_type === 'email' ? 'email.queue' : 'push.queue';
    await publishNotification({ routingKey, payload });

    return reply.code(202).send(successResponse({ request_id: payload.request_id }, 'notification_request_received'));
  } catch (err) {
    req.log.error(err);
    return reply.code(500).send(errorResponse('failed_to_publish', err.message || 'internal'));
  }
}

module.exports = { createNotification, schema };
