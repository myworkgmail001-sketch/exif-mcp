import { ImageSourceType } from '../types/image.js';
import { loadImage } from '../tools/loaders.js';

export type ImageFormat = 'jpeg' | 'png' | 'tiff' | 'heif' | 'unknown';

export interface ImageInfo {
  format: ImageFormat;
  mime: string;
  width?: number;
  height?: number;
  size: number;
}

export const MIME_BY_FORMAT: Record<ImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  tiff: 'image/tiff',
  heif: 'image/heic',
  unknown: 'application/octet-stream',
};

export function detectFormat(buf: Uint8Array | Buffer): ImageFormat {
  if (buf.length < 4) return 'unknown';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0x00) ||
    (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0x00 && buf[3] === 0x2a)
  ) {
    return 'tiff';
  }
  if (buf.length >= 12 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return 'heif';
  }
  return 'unknown';
}

export function getImageInfo(buf: Uint8Array | Buffer): ImageInfo {
  const format = detectFormat(buf);
  const info: ImageInfo = {
    format,
    mime: MIME_BY_FORMAT[format],
    size: buf.length,
  };
  if (format === 'jpeg') {
    const dims = jpegDimensions(buf);
    if (dims) {
      info.width = dims.width;
      info.height = dims.height;
    }
  } else if (format === 'png') {
    if (buf.length >= 24) {
      info.width = readUInt32BE(buf, 16);
      info.height = readUInt32BE(buf, 20);
    }
  }
  return info;
}

function readUInt32BE(buf: Uint8Array | Buffer, offset: number): number {
  return (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
}

function jpegDimensions(buf: Uint8Array | Buffer): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const segLen = (buf[i + 2] << 8) | buf[i + 3];
    if (segLen < 2) break;
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      return {
        height: (buf[i + 5] << 8) | buf[i + 6],
        width: (buf[i + 7] << 8) | buf[i + 8],
      };
    }
    i += 2 + segLen;
  }
  return null;
}

export interface JpegSegment {
  marker: number;
  name: string;
  offset: number;
  length: number;
}

export const METADATA_SEGMENTS = new Set(['exif', 'xmp', 'icc', 'mpf', 'iptc', 'adobe']);

export function identifyAppSegment(marker: number, buf: Uint8Array | Buffer, start: number, len: number): string {
  const ascii = (off: number, n: number) => {
    const end = Math.min(start + off + n, buf.length);
    return Buffer.from(buf.slice(start + off, end)).toString('latin1');
  };
  if (marker === 0xe0) {
    if (ascii(0, 5) === 'JFIF\u0000') return 'jfif';
    if (ascii(0, 5) === 'JFXX\u0000') return 'jfxx';
    return 'app0';
  }
  if (marker === 0xe1) {
    if (ascii(0, 6) === 'Exif\u0000\u0000') return 'exif';
    if (ascii(0, 28) === 'http://ns.adobe.com/xap/1.0/') return 'xmp';
    if (ascii(0, 28) === 'http://ns.adobe.com/pdf/1.3/') return 'xmp';
    return 'app1';
  }
  if (marker === 0xe2) {
    if (ascii(0, 12) === 'ICC_PROFILE\u0000') return 'icc';
    if (ascii(0, 4) === 'MPF\u0000') return 'mpf';
    return 'app2';
  }
  if (marker === 0xed) {
    if (ascii(0, 14) === 'Photoshop 3.0\u0000') return 'iptc';
    return 'app13';
  }
  if (marker === 0xee) {
    if (ascii(0, 5) === 'Adobe') return 'adobe';
    return 'app14';
  }
  return 'unknown';
}

export function scanJpegSegments(buf: Uint8Array | Buffer): JpegSegment[] {
  const segments: JpegSegment[] = [];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const segLen = (buf[i + 2] << 8) | buf[i + 3];
    if (segLen < 2) break;
    const name = marker >= 0xe0 && marker <= 0xef ? identifyAppSegment(marker, buf, i + 4, segLen - 2) : 'unknown';
    segments.push({ marker, name, offset: i, length: 2 + segLen });
    i += 2 + segLen;
  }
  return segments;
}

export function stripJpeg(buf: Uint8Array | Buffer): { data: Buffer; removed: string[] } {
  const removed: string[] = [];
  const chunks: Buffer[] = [Buffer.from([0xff, 0xd8])];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) {
      chunks.push(Buffer.from(buf.slice(i)));
      break;
    }
    const marker = buf[i + 1];
    if (marker === 0xd9) {
      chunks.push(Buffer.from(buf.slice(i, i + 2)));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      chunks.push(Buffer.from(buf.slice(i, i + 2)));
      i += 2;
      continue;
    }
    const segLen = (buf[i + 2] << 8) | buf[i + 3];
    if (segLen < 2) {
      chunks.push(Buffer.from(buf.slice(i)));
      break;
    }
    const name = marker >= 0xe0 && marker <= 0xef ? identifyAppSegment(marker, buf, i + 4, segLen - 2) : 'unknown';
    if (METADATA_SEGMENTS.has(name)) {
      removed.push(name);
    } else {
      chunks.push(Buffer.from(buf.slice(i, i + 2 + segLen)));
    }
    i += 2 + segLen;
  }
  return { data: Buffer.concat(chunks), removed: [...new Set(removed)] };
}

export const PNG_META_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME', 'iCCP']);

export function stripPng(buf: Uint8Array | Buffer): { data: Buffer; removed: string[] } {
  const removed: string[] = [];
  const chunks: Buffer[] = [Buffer.from(buf.slice(0, 8))];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = readUInt32BE(buf, i);
    if (i + 12 + len > buf.length) break;
    const type = Buffer.from(buf.slice(i + 4, i + 8)).toString('latin1');
    if (PNG_META_CHUNKS.has(type)) {
      removed.push(type);
    } else {
      chunks.push(Buffer.from(buf.slice(i, i + 12 + len)));
    }
    i += 12 + len;
  }
  return { data: Buffer.concat(chunks), removed: [...new Set(removed)] };
}

export interface StripResult {
  data: Buffer;
  removed: string[];
  format: ImageFormat;
  mime: string;
  sizeBefore: number;
  sizeAfter: number;
}

export async function stripImage(src: ImageSourceType): Promise<StripResult> {
  const buf = await loadImage(src);
  const format = detectFormat(buf);
  const sizeBefore = buf.length;
  if (format === 'jpeg') {
    const { data, removed } = stripJpeg(buf);
    return { data, removed, format, mime: 'image/jpeg', sizeBefore, sizeAfter: data.length };
  }
  if (format === 'png') {
    const { data, removed } = stripPng(buf);
    return { data, removed, format, mime: 'image/png', sizeBefore, sizeAfter: data.length };
  }
  throw new Error(
    `Metadata stripping is not supported for ${format === 'unknown' ? 'this file type' : format + ' files'}. Supported formats: JPEG, PNG.`
  );
}
