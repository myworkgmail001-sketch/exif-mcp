import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import piexif from 'piexifjs';
import {
  detectFormat,
  getImageInfo,
  scanJpegSegments,
  stripJpeg,
  stripPng,
  stripImage,
  identifyAppSegment,
} from '../src/web/image.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleJpegPath = path.join(__dirname, 'fixtures', 'sample.jpg');

function makeExifJpeg(): Buffer {
  const base = fs.readFileSync(sampleJpegPath);
  const exifObj = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {} };
  exifObj['0th'][piexif.ImageIFD.Make] = 'Test Cam';
  exifObj['0th'][piexif.ImageIFD.Model] = 'X100';
  exifObj['0th'][piexif.ImageIFD.ImageDescription] = 'Hello World';
  exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = 'N';
  exifObj.GPS[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(50.3);
  exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = 'E';
  exifObj.GPS[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(14.82);
  const bytes = piexif.dump(exifObj);
  return Buffer.from(piexif.insert(bytes, base.toString('binary')), 'binary');
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePngWithMetadata(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const idat = zlib.deflateSync(Buffer.concat([Buffer.from([0]), Buffer.from([255, 0, 0, 255])]));
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('eXIf', Buffer.from('fake-exif-tiff-data')),
    pngChunk('tEXt', Buffer.from('Comment\u0000hello')),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('detectFormat', () => {
  it('detects JPEG, PNG and TIFF magic bytes', () => {
    expect(detectFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe('jpeg');
    expect(detectFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe('png');
    expect(detectFormat(Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x00]))).toBe('tiff');
    expect(detectFormat(Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00]))).toBe('tiff');
    expect(detectFormat(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBe('unknown');
  });

  it('returns image info for JPEG and PNG', () => {
    const jpeg = makeExifJpeg();
    const info = getImageInfo(jpeg);
    expect(info.format).toBe('jpeg');
    expect(info.mime).toBe('image/jpeg');
    expect(info.width).toBe(1);
    expect(info.height).toBe(1);

    const png = makePngWithMetadata();
    const pngInfo = getImageInfo(png);
    expect(pngInfo.format).toBe('png');
    expect(pngInfo.width).toBe(1);
    expect(pngInfo.height).toBe(1);
  });
});

describe('JPEG segment scanning', () => {
  it('identifies EXIF, XMP and JFIF APP segments', () => {
    const jpeg = makeExifJpeg();
    const segments = scanJpegSegments(jpeg);
    const names = segments.map(s => s.name);
    expect(names).toContain('jfif');
    expect(names).toContain('exif');
  });

  it('identifies a raw EXIF signature', () => {
    const buf = Buffer.concat([Buffer.from('Exif\u0000\u0000'), Buffer.alloc(10)]);
    expect(identifyAppSegment(0xe1, buf, 0, buf.length)).toBe('exif');
    expect(identifyAppSegment(0xe1, Buffer.from('http://ns.adobe.com/xap/1.0/\u0000x'), 0, 30)).toBe('xmp');
    expect(identifyAppSegment(0xe2, Buffer.from('ICC_PROFILE\u0000x'), 0, 13)).toBe('icc');
    expect(identifyAppSegment(0xed, Buffer.from('Photoshop 3.0\u0000x'), 0, 15)).toBe('iptc');
  });
});

describe('stripJpeg', () => {
  it('removes EXIF segments but keeps the image intact', () => {
    const jpeg = makeExifJpeg();
    const before = scanJpegSegments(jpeg).map(s => s.name);
    expect(before).toContain('exif');

    const { data, removed } = stripJpeg(jpeg);
    expect(removed).toContain('exif');
    expect(data.length).toBeLessThan(jpeg.length);
    expect(data[0]).toBe(0xff);
    expect(data[1]).toBe(0xd8);
    expect(data[data.length - 2]).toBe(0xff);
    expect(data[data.length - 1]).toBe(0xd9);

    const after = scanJpegSegments(data).map(s => s.name);
    expect(after).not.toContain('exif');
    expect(after).toContain('jfif');

    const info = getImageInfo(data);
    expect(info.width).toBe(1);
    expect(info.height).toBe(1);
  });

  it('returns no changes for an image without metadata', () => {
    const jpeg = fs.readFileSync(sampleJpegPath);
    const { data, removed } = stripJpeg(jpeg);
    expect(removed).toHaveLength(0);
    expect(data.equals(jpeg)).toBe(true);
  });
});

describe('stripPng', () => {
  it('removes eXIf and text chunks but keeps image data', () => {
    const png = makePngWithMetadata();
    const { data, removed } = stripPng(png);
    expect(removed).toContain('eXIf');
    expect(removed).toContain('tEXt');
    expect(data.length).toBeLessThan(png.length);

    const kept = data.slice(8).toString('latin1');
    expect(kept).toContain('IHDR');
    expect(kept).toContain('IDAT');
    expect(kept).toContain('IEND');
    expect(kept).not.toContain('eXIf');
    expect(kept).not.toContain('tEXt');
  });
});

describe('stripImage', () => {
  it('strips via ImageSource and reports sizes', async () => {
    const jpeg = makeExifJpeg();
    const result = await stripImage({ kind: 'base64', data: jpeg.toString('base64') });
    expect(result.removed).toContain('exif');
    expect(result.format).toBe('jpeg');
    expect(result.mime).toBe('image/jpeg');
    expect(result.sizeBefore).toBe(jpeg.length);
    expect(result.sizeAfter).toBeLessThan(result.sizeBefore);
  });

  it('rejects unsupported formats', async () => {
    const tiff = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]);
    await expect(stripImage({ kind: 'base64', data: tiff.toString('base64') })).rejects.toThrow(/not supported/);
  });
});
