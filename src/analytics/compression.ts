/**
 * Compression utilities for session recordings
 * Uses native CompressionStream API when available, with base64 fallback
 */

/**
 * Compresses data using gzip and returns base64 encoded string
 */
export async function compressToBase64(data: string): Promise<string> {
  // Check if CompressionStream is available (modern browsers)
  if (typeof CompressionStream !== "undefined") {
    try {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(data));
          controller.close();
        },
      });

      const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
      const reader = compressedStream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Convert to base64
      return uint8ArrayToBase64(combined);
    } catch (error) {
      console.warn("[Echoes:Compression] CompressionStream failed, using fallback:", error);
      // Fall through to fallback
    }
  }

  // Fallback: just base64 encode without compression
  // This is less efficient but works everywhere
  return btoa(unescape(encodeURIComponent(data)));
}

/**
 * Decompresses base64 encoded gzip data
 */
export async function decompressFromBase64(base64Data: string): Promise<string> {
  // Check if DecompressionStream is available (modern browsers)
  if (typeof DecompressionStream !== "undefined") {
    try {
      const compressed = base64ToUint8Array(base64Data);

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(compressed);
          controller.close();
        },
      });

      const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
      const reader = decompressedStream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Decode text
      const decoder = new TextDecoder();
      return decoder.decode(combined);
    } catch (error) {
      console.warn("[Echoes:Compression] DecompressionStream failed, using fallback:", error);
      // Fall through to fallback
    }
  }

  // Fallback: just base64 decode (assumes data wasn't compressed)
  return decodeURIComponent(escape(atob(base64Data)));
}

/**
 * Converts Uint8Array to base64 string
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Use btoa with binary string
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts base64 string to Uint8Array
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Estimates the size of a string in bytes
 */
export function estimateStringSize(str: string): number {
  // UTF-8 encoding size estimation
  let size = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      size += 1;
    } else if (code < 0x800) {
      size += 2;
    } else if (code < 0x10000) {
      size += 3;
    } else {
      size += 4;
    }
  }
  return size;
}
