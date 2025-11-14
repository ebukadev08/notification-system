const Redis = require('ioredis');
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

async function initRedis() {
  await redis.ping();
  console.log('✅ Connected to Redis');
}

async function isProcessedThenSet(request_id, ttl_seconds = 86400) {
  if (!request_id) return false;
  const set = await redis.set(`req:${request_id}`, '1', 'NX', 'EX', ttl_seconds);
  return set !== 'OK'; 
}

module.exports = { initRedis, isProcessedThenSet };
