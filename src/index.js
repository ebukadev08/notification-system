const fastify = require("fastify")({ logger: true });
const routes = require("./routes");
const { initRabbit } = require("./services/rabbitmq_publisher");
const { initRedis } = require("./plugins/idempotency");

async function start() {
  try {
    await initRabbit();
    await initRedis();

    fastify.register(routes, { prefix: "/api/v1" });

    fastify.get("/health", async () => ({ success: true, message: "ok" }));

    const port = process.env.PORT || 3000;
    await fastify.listen({ port, host: "0.0.0.0" });
    fastify.log.info(`Server running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
