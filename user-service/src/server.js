import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { Client } from "pg";
import dotenv from "dotenv";
import bcrypt from "bcrypt";

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


// health
fastify.get("/health", async () => ({ status: "ok" }));

// Create user
fastify.post("/api/v1/users", {
  schema: {
    body: {
      type: "object",
      required: ["name","email","password","preferences"],
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        push_token: { type: ["string","null"] },
        preferences: { type: "object", properties: { email: {type:"boolean"}, push:{type:"boolean"} } },
        password: { type: "string" }
      }
    }
  }
}, async (req, reply) => {
  const { name, email, push_token, preferences, password } = req.body;
  const hashed = await bcrypt.hash(password, 10);
  try {
    const res = await client.query(
      `INSERT INTO users (name,email,push_token,preferences,password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,email,preferences,push_token`,
      [name,email,push_token || null, JSON.stringify(preferences), hashed]
    );
    return { success: true, data: res.rows[0], message: "user_created", meta: { total:1, limit:1, page:1, total_pages:1, has_next:false, has_previous:false } };
  } catch (err) {
    fastify.log.error(err);
    return reply.code(400).send({ success:false, error: err.message, message: "could_not_create_user" });
  }
});

fastify.get("/api/v1/users", async (req, reply) => {
  const users = await client.query("SELECT * FROM users");
  if(!users){
    return reply.code(404).send({success: false, message: "Users not found"})
  }
  return {success: true, data: users.rows }
})

// Get user
fastify.get("/api/v1/users/:id", async (req, reply) => {
  const { id } = req.params;
  const res = await client.query("SELECT id,name,email,push_token,preferences FROM users WHERE id=$1", [id]);
  if (res.rows.length === 0) return reply.code(404).send({ success:false, message:"not_found" });
  return { success:true, data: res.rows[0], message: "user_found" };
});

// Update push token or preferences
fastify.put("/api/v1/users/:id", async (req, reply) => {
  const { id } = req.params;
  const { push_token, preferences } = req.body;
  const res = await client.query("UPDATE users SET push_token = COALESCE($1,push_token), preferences=COALESCE($2,preferences), updated_at=now() WHERE id=$3 RETURNING id,name,email,push_token,preferences", [push_token || null, preferences ? JSON.stringify(preferences) : null, id]);
  if (res.rows.length === 0) return reply.code(404).send({ success:false, message:"not_found" });
  return { success:true, data: res.rows[0], message: "user_updated" };
});

// find user preferences for sync lookups
fastify.get("/api/v1/users/:id/preferences", async (req, reply) => {
  const { id } = req.params;
  const res = await client.query("SELECT preferences FROM users WHERE id=$1", [id]);
  if (res.rows.length === 0) return reply.code(404).send({ success:false, message:"not_found" });
  return { success:true, data: res.rows[0].preferences, message:"preferences_found" };
});

const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: "0.0.0.0" });
    fastify.log.info("user-service listening");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
