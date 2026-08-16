import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import exifr from 'exifr';
import { loadImage } from '../tools/loaders.js';
import { buildOptions } from '../tools/segments.js';
import { ImageSourceType } from '../types/image.js';
import { getImageInfo, stripImage } from './image.js';
import { editImage, EditChanges } from './edit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.join(__dirname, '..', '..', 'web');
const PORT = Number(process.env.WEB_PORT || process.env.PORT || 3000);
const MAX_BODY = 45 * 1024 * 1024;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJSON(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body exceeds 45MB limit'));
        req.destroy();
        return;
      }
      data += chunk.toString('utf8');
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function toDataUrl(mime: string, buf: Buffer): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  const body = await readBody(req);
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function requireImage(parsed: any): ImageSourceType {
  const image = parsed?.image;
  if (!image || !image.kind) {
    throw new Error('Missing "image" object. Use { image: { kind, path | url | data | buffer } }');
  }
  return image;
}

async function analyze(src: ImageSourceType) {
  const buf = await loadImage(src);
  const info = getImageInfo(buf);
  const [metadata, orientation, gps, rotation, thumbnail] = await Promise.all([
    exifr.parse(buf, buildOptions()),
    exifr.orientation(buf),
    exifr.gps(buf),
    exifr.rotation(buf),
    exifr.thumbnail(buf),
  ]);

  return {
    info,
    metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null,
    orientation: orientation ?? null,
    gps: gps ?? null,
    rotation: rotation ?? null,
    thumbnailDataUrl: thumbnail
      ? `data:image/jpeg;base64,${Buffer.from(thumbnail).toString('base64')}`
      : null,
  };
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, url: string) {
  try {
    const parsed = await parseJsonBody(req);

    if (url === '/api/analyze') {
      const result = await analyze(requireImage(parsed));
      sendJSON(res, 200, result);
      return;
    }

    if (url === '/api/strip') {
      const result = await stripImage(requireImage(parsed));
      sendJSON(res, 200, {
        dataUrl: toDataUrl(result.mime, result.data),
        mime: result.mime,
        format: result.format,
        removed: result.removed,
        sizeBefore: result.sizeBefore,
        sizeAfter: result.sizeAfter,
      });
      return;
    }

    if (url === '/api/edit') {
      const image = requireImage(parsed);
      const changes: EditChanges = {
        fields: parsed.fields ?? undefined,
        gps: parsed.gps ?? undefined,
        clearGps: parsed.clearGps ?? undefined,
      };
      const result = await editImage(image, changes);
      sendJSON(res, 200, {
        dataUrl: toDataUrl(result.mime, result.data),
        mime: result.mime,
        changed: result.changed,
      });
      return;
    }

    sendJSON(res, 404, { error: 'Unknown endpoint' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJSON(res, 400, { error: message });
  }
}

function serveStatic(res: http.ServerResponse, filePath: string) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0];

  if (req.method === 'POST' && url.startsWith('/api/')) {
    await handleApi(req, res, url);
    return;
  }

  if (req.method === 'GET' && url === '/api/health') {
    sendJSON(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET') {
    if (url === '/' || url === '/index.html') {
      serveStatic(res, path.join(webDir, 'index.html'));
      return;
    }
    const filePath = path.normalize(path.join(webDir, url));
    if (!filePath.startsWith(webDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      serveStatic(res, filePath);
      return;
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.error(`exif-mcp web server running at ${url}`);
  if (process.env.WEB_OPEN === '1') {
    const opener =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'start'
          : 'xdg-open';
    try {
      const { exec } = require('child_process');
      exec(`${opener} ${url}`);
    } catch {
      // ignore - browser opening is best effort
    }
  }
});
