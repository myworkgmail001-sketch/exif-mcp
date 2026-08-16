import piexif from 'piexifjs';
import { ImageSourceType } from '../types/image.js';
import { loadImage } from '../tools/loaders.js';
import { detectFormat } from './image.js';

export interface GpsChange {
  latitude: number;
  longitude: number;
}

export interface EditChanges {
  fields?: Record<string, string>;
  gps?: GpsChange;
  clearGps?: boolean;
}

export interface EditResult {
  data: Buffer;
  mime: string;
  changed: string[];
}

const STRING_TAGS: Record<string, { ifd: '0th' | 'Exif'; tag: number }> = {
  Make: { ifd: '0th', tag: piexif.ImageIFD.Make },
  Model: { ifd: '0th', tag: piexif.ImageIFD.Model },
  Software: { ifd: '0th', tag: piexif.ImageIFD.Software },
  Artist: { ifd: '0th', tag: piexif.ImageIFD.Artist },
  Copyright: { ifd: '0th', tag: piexif.ImageIFD.Copyright },
  ImageDescription: { ifd: '0th', tag: piexif.ImageIFD.ImageDescription },
  DateTime: { ifd: '0th', tag: piexif.ImageIFD.DateTime },
  DateTimeOriginal: { ifd: 'Exif', tag: piexif.ExifIFD.DateTimeOriginal },
  DateTimeDigitized: { ifd: 'Exif', tag: piexif.ExifIFD.DateTimeDigitized },
  UserComment: { ifd: 'Exif', tag: piexif.ExifIFD.UserComment },
};

export function emptyExifObject(): Record<string, any> {
  return { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {} };
}

export function decodeImage(src: ImageSourceType): Promise<Buffer> {
  return loadImage(src).then(buf => Buffer.from(buf));
}

export function applyChanges(exifObj: Record<string, any>, changes: EditChanges): string[] {
  const changed: string[] = [];
  const fields = changes.fields || {};
  for (const [name, value] of Object.entries(fields)) {
    const def = STRING_TAGS[name];
    if (!def) continue;
    if (value === '') {
      delete exifObj[def.ifd][def.tag];
    } else {
      exifObj[def.ifd][def.tag] = value;
    }
    changed.push(name);
  }

  if (changes.clearGps && exifObj.GPS) {
    if (Object.keys(exifObj.GPS).length > 0) changed.push('GPS');
    for (const key of Object.keys(exifObj.GPS)) delete exifObj.GPS[key];
  }

  if (changes.gps && Number.isFinite(changes.gps.latitude) && Number.isFinite(changes.gps.longitude)) {
    const { latitude, longitude } = changes.gps;
    const gps = exifObj.GPS;
    gps[piexif.GPSIFD.GPSLatitudeRef] = latitude < 0 ? 'S' : 'N';
    gps[piexif.GPSIFD.GPSLatitude] = piexif.GPSHelper.degToDmsRational(Math.abs(latitude));
    gps[piexif.GPSIFD.GPSLongitudeRef] = longitude < 0 ? 'W' : 'E';
    gps[piexif.GPSIFD.GPSLongitude] = piexif.GPSHelper.degToDmsRational(Math.abs(longitude));
    changed.push('GPS');
  }

  return [...new Set(changed)];
}

export async function editImage(src: ImageSourceType, changes: EditChanges): Promise<EditResult> {
  const buf = await decodeImage(src);
  const format = detectFormat(buf);
  if (format !== 'jpeg') {
    throw new Error(`EXIF editing is only supported for JPEG images, got: ${format}`);
  }

  const jpeg = buf.toString('binary');
  let exifObj: Record<string, any>;
  try {
    exifObj = piexif.load(jpeg);
  } catch {
    exifObj = emptyExifObject();
  }

  const changed = applyChanges(exifObj, changes);
  const exifBytes = piexif.dump(exifObj);
  const newJpeg = piexif.insert(exifBytes, jpeg);
  return { data: Buffer.from(newJpeg, 'binary'), mime: 'image/jpeg', changed };
}
