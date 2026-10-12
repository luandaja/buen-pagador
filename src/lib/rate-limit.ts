import { Redis } from '@upstash/redis';
import { credentials } from './store';

export interface Limiter {
  hit(key: string, windowSeconds: number): Promise<number>;
}

class RedisLimiter implements Limiter {
  constructor(private redis: Redis) {}

  async hit(key: string, windowSeconds: number) {
    const transaction = this.redis.multi();
    transaction.incr(key);
    transaction.expire(key, windowSeconds, 'NX');
    const [count] = await transaction.exec<[number, number]>();
    return Number(count);
  }
}

class MemoryLimiter implements Limiter {
  private hits = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowSeconds: number) {
    const now = Date.now();
    const current = this.hits.get(key);
    const entry = current && current.resetAt > now ? current : { count: 0, resetAt: now + windowSeconds * 1000 };
    entry.count += 1;
    this.hits.set(key, entry);
    return entry.count;
  }
}

let limiter: Limiter | null = null;

export function getLimiter(): Limiter {
  const upstash = credentials();
  limiter ??= upstash ? new RedisLimiter(new Redis({ ...upstash, automaticDeserialization: false })) : new MemoryLimiter();
  return limiter;
}

export function resetLimiter() {
  limiter = null;
}

export { MemoryLimiter, RedisLimiter };
