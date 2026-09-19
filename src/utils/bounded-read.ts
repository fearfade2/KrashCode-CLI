import { open } from 'node:fs/promises';

/** Read at most limit + 1 bytes, including when a file grows after stat. */
export async function readBounded(path: string, limit: number): Promise<Buffer> {
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('Not a regular file.');
    if (info.size > limit) throw new Error(`File exceeds the ${limit} byte limit.`);
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error(`File exceeds the ${limit} byte limit.`);
    return buffer.subarray(0, length);
  } finally {
    await file.close();
  }
}
