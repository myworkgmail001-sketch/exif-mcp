import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import piexif from 'piexifjs';
import exifr from 'exifr';
import { editImage, emptyExifObject, applyChanges } from '../src/web/edit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleJpegPath = path.join(__dirname, 'fixtures', 'sample.jpg');

function makeExifJpeg(): Buffer {
  const base = fs.readFileSync(sampleJpegPath);
  const exifObj = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {} };
  exifObj['0th'][piexif.ImageIFD.Make] = 'Old Cam';
  exifObj.GPS[piexif.GPSIFD.GPSLatitudeRef] = 'N';
  exifObj.GPS[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(50.0);
  exifObj.GPS[piexif.GPSIFD.GPSLongitudeRef] = 'E';
  exifObj.GPS[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(10.0);
  const bytes = piexif.dump(exifObj);
  return Buffer.from(piexif.insert(bytes, base.toString('binary')), 'binary');
}

async function parseMeta(buf: Buffer): Promise<any> {
  return exifr.parse(buf, { tiff: true });
}

describe('editImage', () => {
  it('edits string EXIF fields', async () => {
    const src = { kind: 'base64', data: makeExifJpeg().toString('base64') };
    const result = await editImage(src, {
      fields: { Make: 'New Cam', Model: 'X200', ImageDescription: 'Edited' },
    });

    expect(result.mime).toBe('image/jpeg');
    expect(result.changed).toContain('Make');
    expect(result.changed).toContain('Model');

    const meta = await parseMeta(result.data);
    expect(meta.Make).toBe('New Cam');
    expect(meta.Model).toBe('X200');
    expect(meta.ImageDescription).toBe('Edited');
  });

  it('sets GPS coordinates from decimal degrees', async () => {
    const src = { kind: 'base64', data: makeExifJpeg().toString('base64') };
    const result = await editImage(src, { gps: { latitude: 48.8584, longitude: 2.2945 } });

    const gps = await exifr.gps(result.data);
    expect(gps).not.toBeNull();
    expect(gps!.latitude).toBeCloseTo(48.8584, 3);
    expect(gps!.longitude).toBeCloseTo(2.2945, 3);
  });

  it('clears GPS coordinates', async () => {
    const src = { kind: 'base64', data: makeExifJpeg().toString('base64') };
    const result = await editImage(src, { clearGps: true });

    const gps = await exifr.gps(result.data);
    expect(gps).toBeUndefined();
  });

  it('creates EXIF when none existed', async () => {
    const plain = fs.readFileSync(sampleJpegPath);
    const result = await editImage({ kind: 'base64', data: plain.toString('base64') }, {
      fields: { Make: 'Brand New' },
    });

    const meta = await parseMeta(result.data);
    expect(meta.Make).toBe('Brand New');
  });

  it('rejects non-JPEG formats', async () => {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(40),
    ]);
    await expect(editImage({ kind: 'base64', data: png.toString('base64') }, { fields: { Make: 'x' } }))
      .rejects.toThrow(/only supported for JPEG/);
  });
});

describe('applyChanges', () => {
  it('removes a tag when value is empty', () => {
    const obj = emptyExifObject();
    obj['0th'][piexif.ImageIFD.Make] = 'Cam';
    applyChanges(obj, { fields: { Make: '' } });
    expect(obj['0th'][piexif.ImageIFD.Make]).toBeUndefined();
  });

  it('applies only valid tags', () => {
    const obj = emptyExifObject();
    const changed = applyChanges(obj, { fields: { Make: 'A', NotATag: 'B' } });
    expect(changed).toEqual(['Make']);
    expect(obj['0th'][piexif.ImageIFD.Make]).toBe('A');
  });
});
