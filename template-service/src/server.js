import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "fastify-sensible";
import { Client } from "pg";
import dotenv from "dotenv";
import mustache from "mustache";

dotenv.config();

const fastify = Fastify({ logger: true });
fastify.register(cors);
fastify.register(sensible);

if(!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not defined in environment variables");
}

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});
await client.connect();

fastify.get("/health", async () => ({ status: "ok" }));

fastify.post("/api/v1/templates", async (req, reply) => {
  const { code, subject, body, language = "en" } = req.body;
  if (!code || !body)
    return reply
      .code(400)
      .send({ success: false, message: "code_and_body_required" });
  // upsert: if exists, insert new version
  const res = await client.query(
    "SELECT id, version FROM templates WHERE code=$1 ORDER BY version DESC LIMIT 1",
    [code]
  );
  let version = 1;
  if (res.rows.length) version = res.rows[0].version + 1;
  const insert = await client.query(
    "INSERT INTO templates (code,language,subject,body,version) VALUES ($1,$2,$3,$4,$5) RETURNING id,code,subject,body,version",
    [code, language, subject, body, version]
  );
  console.log("Incoming code:", code);
  console.log("DB result:", res.rows);
  return { success: true, data: insert.rows[0], message: "template_saved" };
});

fastify.get("/api/v1/templates/:code", async (req, reply) => {
  const { code } = req.params;
  const res = await client.query(
    "SELECT code, subject, body, version FROM templates WHERE code= $1 ORDER BY version DESC LIMIT 1",
    [code]
  );
  if (res.rows.length === 0)
    return reply.code(404).send({ success: false, message: "not_found" });
  return { success: true, data: res.rows[0], message: "template_found" };
});

fastify.post("/api/v1/templates/:code/render", async (req, reply) => {
  const { code } = req.params;
  const vars = req.body.variable || {};
  const res = await client.query(
    "SELECT code, subject, body, version FROM templates WHERE code=$1 ORDER BY version DESC LIMIT 1",
    [code]
  );
  if (res.rows.length === 0)
    return reply.code(404).send({ success: true, message: "not_found" });
  const tmpl = res.rows[0];
  const rendered_subject = mustache.render(tmpl.subject || "", vars);
  const rendered_body = mustache.render(tmpl.body || "", vars);
  return {
    success: true,
    data: {
      subject: rendered_subject,
      body: rendered_body,
      message: "rendered",
    },
  };
});

fastify.delete("/api/v1/templates/:code", async (req, reply) => {
  const { code } = req.params;

  const res = await client.query(
    "UPDATE templates SET deleted = true WHERE code = $1 AND deleted = false RETURNING *",
    [code]
  );

  if (res.rowCount === 0) {
    return reply.code(404).send({
      success: false,
      message: "not_found_or_already_deleted",
    });
  }

  return {
    success: true,
    message: "template_soft_deleted",
  };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3002, host: "0.0.0.0" });
    fastify.log.info("template-service listening");
  } catch (error) {
    fastify.log.error(error);
    process.exist(1);
  }
};

start();
