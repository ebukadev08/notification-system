import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { Client } from "pg";
import amqplib from "amqplib";
import dotenv from "dotenv";

dotenv.config();

const fastify = Fastify({ logger: true });
fastify.register(cors);
fastify.register(sensible);

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:ebuka@postgres:5432/notifications";
const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://guest:guest@rabbitmq:5672/";

const pg = new Client({ connectionString: DATABASE_URL });
await pg.connect();

let amqpConn;
let amqpChannel;
async function setupAmqp(){
  amqpConn = await amqplib.connect(RABBITMQ_URL);
  amqpChannel = await amqpConn.createChannel();
  await amqpChannel.assertQueue("email.queue", { durable: true });
  await amqpChannel.assertQueue("push.queue", { durable: true });
  await amqpChannel.assertQueue("failed.queue", { durable: true });
}
await setupAmqp();

// health
fastify.get("/health", async () => ({ status: "ok" }));

// POST /api/v1/notifications
fastify.post("/api/v1/notifications", {
  schema: {
    body: {
      type: "object",
      required: ["notification_type","user_id","template_code","request_id"],
      properties: {
        request_id: { type: "string" },
        notification_type: { type: "string", enum: ["email","push"] },
        user_id: { type: "string" },
        template_code: { type: "string" },
        variables: { type: "object" },
        priority: { type: "integer" },
        metadata: { type: "object" }
      }
    }
  }
}, async (req, reply) => {
  const { request_id, notification_type, user_id, template_code, variables = {}, priority = 0, metadata = {} } = req.body;

  try {
    // idempotency: try to insert row; if already exists, return existing one
    const insertSql = `
      INSERT INTO notifications (request_id, user_id, notification_type, template_code, variables, status, created_at)
      VALUES ($1,$2,$3,$4,$5,'pending',now())
      ON CONFLICT (request_id) DO NOTHING
      RETURNING id, request_id, user_id, notification_type, template_code, variables, status, attempts, created_at
    `;
    const res = await pg.query(insertSql, [request_id, user_id, notification_type, template_code, JSON.stringify(variables)]);
    let row;
    if (res.rows.length > 0) {
      row = res.rows[0];
    } else {
      // fetch existing
      const r2 = await pg.query("SELECT id, request_id, user_id, notification_type, template_code, variables, status, attempts, created_at FROM notifications WHERE request_id=$1", [request_id]);
      row = r2.rows[0];
      // if exists, return it and do NOT republish
      return reply.code(200).send({ success: true, message: "already_exists", data: row });
    }

    // publish to queue
    const payload = {
      request_id,
      user_id,
      template_code,
      variables,
      notification_type,
      _attempt: 0
    };

    const q = (notification_type === "email") ? "email.queue" : "push.queue";
    amqpChannel.sendToQueue(q, Buffer.from(JSON.stringify(payload)), { persistent: true });
    return { success: true, message: "queued", data: row };
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ success: false, message: "internal_error", error: err.message });
  }
});

// POST /api/v1/notifications/status
fastify.post("/api/v1/notifications/status", async (req, reply) => {
  const { notification_id, status, timestamp = null, error = null } = req.body;
  if (!notification_id || !status) return reply.code(400).send({ success:false, message:"notification_id_and_status_required" });
  try {
    // increment attempts if status indicates failure? Consumers send attempts via DB if needed.
    await pg.query("UPDATE notifications SET status=$1, error=$2, updated_at=now() WHERE request_id=$3", [status, error, notification_id]);
    return reply.code(200).send({ success: true, message: "status_updated", timestamp: timestamp || new Date().toISOString() });
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ success: false, message: "db_error", error: err.message });
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    fastify.log.info("api-gateway listening");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
