import { createHash } from 'node:crypto'

export function netkeibaHorseShard(horseId: string, shardCount: number) {
  if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error(`Invalid netkeiba shard count: ${shardCount}`)
  return createHash('sha256').update(horseId).digest().readUInt32BE(0) % shardCount
}

export function netkeibaHorseRepairShard(horseId: string, shardCount: number) {
  if (!Number.isInteger(shardCount) || shardCount < 1) throw new Error(`Invalid netkeiba shard count: ${shardCount}`)
  return createHash('sha256').update(`repair:${horseId}`).digest().readUInt32BE(0) % shardCount
}
