const notificationsController = require('./controllers/notifications_controller');

async function routes(fastify, opts) {
  fastify.post(
    '/notifications',
    { schema: notificationsController.schema },
    notificationsController.createNotification
  );

  fastify.register(async function (instance) {
    instance.post('/', async (req, reply) => {
      return { success: true, message: 'proxy stub' };
    });
  }, { prefix: '/users' });
}

module.exports = routes;
