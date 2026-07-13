export const CHANNEL_NAME_MAX = 100;
export const CHANNEL_DESCRIPTION_MAX = 2000;
export const CHANNEL_POST_MAX = 100_000;
export const CHANNEL_PEER_BASE = BigInt(1_000_000_000_000_000);
export const CHANNEL_PEER_RANGE = BigInt(900_000_000_000_000);

export interface ChannelRecord {
  channelId: string;
  ownerPubkey: string;
  name: string;
  description?: string;
  picture?: string;
  subscribed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ChannelPostRecord {
  eventId: string;
  channelId: string;
  authorPubkey: string;
  content: string;
  createdAt: number;
}

export interface ChannelMetadata {
  name: string;
  about?: string;
  picture?: string;
}

export function parseChannelMetadata(content: string): ChannelMetadata | null {
  if(typeof content !== 'string' || content.length > CHANNEL_DESCRIPTION_MAX + 4096) return null;
  try {
    const value = JSON.parse(content);
    if(!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if(typeof value.name !== 'string' || value.name.trim().length === 0 || value.name.length > CHANNEL_NAME_MAX) return null;
    if(value.about !== undefined && (typeof value.about !== 'string' || value.about.length > CHANNEL_DESCRIPTION_MAX)) return null;
    if(value.picture !== undefined && (typeof value.picture !== 'string' || value.picture.length > 2048)) return null;
    return {name: value.name.trim(), about: value.about, picture: value.picture};
  } catch{
    return null;
  }
}

export function getRootChannelId(tags: string[][]): string | null {
  const root = tags.find(tag => tag[0] === 'e' && /^[0-9a-f]{64}$/.test(tag[1] || ''));
  return root?.[1] ?? null;
}

export function isChannelPeer(peerId: number): boolean {
  const absolute = Math.abs(peerId);
  return peerId < 0 && absolute >= Number(CHANNEL_PEER_BASE) && absolute < 2_000_000_000_000_000;
}

export async function channelIdToPeerId(channelId: string): Promise<number> {
  if(!/^[0-9a-f]{64}$/.test(channelId)) throw new Error('Invalid channel ID');
  const firstEight = new Uint8Array(8);
  for(let index = 0; index < 8; index++) firstEight[index] = parseInt(channelId.slice(index * 2, index * 2 + 2), 16);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', firstEight));
  let value = BigInt(0);
  for(let index = 0; index < 8; index++) value = (value << BigInt(8)) | BigInt(digest[index]);
  return -Number(CHANNEL_PEER_BASE + (value % CHANNEL_PEER_RANGE));
}
