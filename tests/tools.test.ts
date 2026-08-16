import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import exifr from 'exifr';
import piexif from 'piexifjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerTools } from '../src/tools/index.js';

// Get current directory for referencing fixtures
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(__dirname, 'fixtures');
const sampleJpegPath = path.join(fixturesDir, 'sample.jpg');

// Mock exifr functions
vi.mock('exifr', () => {
  const api = {
    parse: vi.fn(),
    orientation: vi.fn(),
    rotation: vi.fn(),
    gps: vi.fn(),
    thumbnail: vi.fn()
  };
  return { default: api };
});

describe('MCP Tools', () => {
  let server: McpServer;
  let tools: Record<string, any>;
  
  beforeAll(() => {
    // Create server instance for testing
    server = new McpServer({ 
      name: 'exif-mcp-test', 
      version: '1.0.0' 
    });
    
    // Register tools and get references to them
    tools = registerTools(server);
    
    // Ensure fixture directory exists
    if (!fs.existsSync(fixturesDir)) {
      fs.mkdirSync(fixturesDir, { recursive: true });
    }
    
    // Create a simple test JPEG if it doesn't exist
    if (!fs.existsSync(sampleJpegPath)) {
      // This is a minimal valid JPEG (1x1 pixel)
      const minimalJpeg = Buffer.from(
        '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==',
        'base64'
      );
      fs.writeFileSync(sampleJpegPath, minimalJpeg);
    }
  });
  
  afterEach(() => {
    // Reset mocks between tests
    vi.clearAllMocks();
  });
  
  describe('read-metadata tool', () => {
    it('should call exifr.parse with all segments enabled by default', async () => {
      // Setup mock return value
      const mockMetadata = { 
        Make: 'Test Camera',
        Model: 'Test Model',
        xmp: { Title: 'Test Image' }
      };
      (exifr.parse as any).mockResolvedValue(mockMetadata);
      
      // Get the tool from the registered tools
      const tool = tools['read-metadata'];
      expect(tool).toBeDefined();
      
      // Call the tool
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      // Verify exifr.parse was called with correct options
      expect(exifr.parse).toHaveBeenCalledTimes(1);
      expect(exifr.parse).toHaveBeenCalledWith(expect.any(Buffer), {
        tiff: true,
        xmp: true, 
        icc: true,
        iptc: true,
        jfif: true,
        ihdr: true
      });
      
      // Verify response
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockMetadata);
    });
    
    it('should call exifr.parse with specific segments when requested', async () => {
      // Setup mock return value
      const mockMetadata = { xmp: { Title: 'Test Image' } };
      (exifr.parse as any).mockResolvedValue(mockMetadata);
      
      // Get the tool from the registered tools
      const tool = tools['read-metadata'];
      expect(tool).toBeDefined();
      
      // Call the tool with specific segments
      const result = await tool.handler(
        {
          image: { kind: 'path', path: sampleJpegPath },
          segments: ['XMP', 'ICC']
        },
        { request: {} }
      );
      
      // Verify exifr.parse was called with correct options
      expect(exifr.parse).toHaveBeenCalledTimes(1);
      expect(exifr.parse).toHaveBeenCalledWith(expect.any(Buffer), {
        tiff: false,
        xmp: true,
        icc: true,
        iptc: false,
        jfif: false,
        ihdr: false
      });
      
      // Verify response
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockMetadata);
    });
    
    it('should handle error when no metadata is found', async () => {
      // Setup mock to return empty object (no metadata)
      (exifr.parse as any).mockResolvedValue({});
      
      // Get the tool from the tools object
      const tool = tools['read-metadata'];
      
      // Call the tool should error
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('No metadata found');
    });
    
    it('should propagate exifr errors', async () => {
      // Setup mock to throw an error
      (exifr.parse as any).mockRejectedValue(new Error('Parse error'));
      
      // Get the tool from the tools object
      const tool = tools['read-metadata'];
      
      // Call the tool should error
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Parse error');
    });
  });
  
  describe('read-exif tool', () => {
    it('should call exifr.parse with EXIF options', async () => {
      // Setup mock return value
      const mockExif = { 
        Make: 'Test Camera',
        Model: 'Test Model',
        ExposureTime: 1/250
      };
      (exifr.parse as any).mockResolvedValue(mockExif);
      
      // Get the tool from the tools object
      const tool = tools['read-exif'];
      expect(tool).toBeDefined();
      
      // Call the tool
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      // Verify exifr.parse was called with correct options
      expect(exifr.parse).toHaveBeenCalledTimes(1);
      expect(exifr.parse).toHaveBeenCalledWith(expect.any(Buffer), {
        tiff: true,
        xmp: false,
        icc: false,
        iptc: false,
        jfif: false,
        ihdr: false
      });
      
      // Verify response
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockExif);
    });
    
    it('should support picking specific EXIF tags', async () => {
      // Setup mock return value
      const mockExif = { Make: 'Test Camera' };
      (exifr.parse as any).mockResolvedValue(mockExif);
      
      // Get the tool from the tools object
      const tool = tools['read-exif'];
      
      // Call the tool with pick list
      const result = await tool.handler(
        {
          image: { kind: 'path', path: sampleJpegPath },
          pick: ['Make']
        },
        { request: {} }
      );
      
      // Verify exifr.parse was called with correct options
      expect(exifr.parse).toHaveBeenCalledTimes(1);
      expect(exifr.parse).toHaveBeenCalledWith(expect.any(Buffer), {
        tiff: true,
        xmp: false,
        icc: false,
        iptc: false,
        jfif: false,
        ihdr: false,
        pick: ['Make']
      });
      
      // Verify response
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockExif);
    });
  });
  
  describe('Segment-specific tools', () => {
    it('should configure read-xmp correctly', async () => {
      const mockXmp = { xmp: { Title: 'Test Image' } };
      (exifr.parse as any).mockResolvedValue(mockXmp);
      
      const tool = tools['read-xmp'];
      expect(tool).toBeDefined();
      
      // Test with extended option
      const result = await tool.handler(
        {
          image: { kind: 'path', path: sampleJpegPath },
          extended: true
        },
        { request: {} }
      );
      
      expect(exifr.parse).toHaveBeenCalledWith(expect.any(Buffer), {
        tiff: false,
        xmp: true,
        icc: false,
        iptc: false,
        jfif: false,
        ihdr: false,
        multiSegment: true
      });
      
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockXmp);
    });
    
    it('should configure read-icc correctly', async () => {
      const mockIcc = { icc: { Description: 'Test ICC Profile' } };
      (exifr.parse as any).mockResolvedValue(mockIcc);
      
      const tool = tools['read-icc'];
      expect(tool).toBeDefined();
      
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(exifr.parse).toHaveBeenCalledWith(expect.any(Buffer), {
        tiff: false,
        xmp: false,
        icc: true,
        iptc: false,
        jfif: false,
        ihdr: false
      });
      
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockIcc);
    });
  });
  
  describe('Specialized tools', () => {
    it('should call exifr.orientation correctly', async () => {
      (exifr.orientation as any).mockResolvedValue(6);
      
      const tool = tools['orientation'];
      expect(tool).toBeDefined();
      
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(exifr.orientation).toHaveBeenCalledWith(expect.any(Buffer));
      
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual({ orientation: 6 });
    });
    
    it('should call exifr.rotation correctly', async () => {
      const mockRotation = { 
        deg: 90, 
        rad: Math.PI/2, 
        scaleX: 1, 
        scaleY: 1, 
        dimensionSwapped: true 
      };
      (exifr.rotation as any).mockResolvedValue(mockRotation);
      
      const tool = tools['rotation-info'];
      expect(tool).toBeDefined();
      
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(exifr.rotation).toHaveBeenCalledWith(expect.any(Buffer));
      
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockRotation);
    });
    
    it('should call exifr.gps correctly', async () => {
      const mockGps = { latitude: 37.7749, longitude: -122.4194 };
      (exifr.gps as any).mockResolvedValue(mockGps);
      
      const tool = tools['gps-coordinates'];
      expect(tool).toBeDefined();
      
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(exifr.gps).toHaveBeenCalledWith(expect.any(Buffer));
      
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toEqual(mockGps);
    });
    
    it('should handle null GPS data gracefully', async () => {
      (exifr.gps as any).mockResolvedValue(null);
      
      const tool = tools['gps-coordinates'];
      
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult).toBeNull();
    });
    
    it('should call exifr.thumbnail correctly and return base64 data URL', async () => {
      // Create mock thumbnail data
      const mockThumbnail = Buffer.from('fake-thumbnail-data');
      (exifr.thumbnail as any).mockResolvedValue(mockThumbnail);
      
      const tool = tools['thumbnail'];
      expect(tool).toBeDefined();
      
      const result = await tool.handler(
        { image: { kind: 'path', path: sampleJpegPath } },
        { request: {} }
      );
      
      expect(exifr.thumbnail).toHaveBeenCalledWith(expect.any(Buffer));
      
      expect(result.content[0].type).toBe('text');
      const parsedResult = JSON.parse(result.content[0].text);
      expect(parsedResult.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    });
  });

  describe('strip-metadata tool', () => {
    it('removes metadata segments and returns a cleaned data URL', async () => {
      // Build a JPEG with embedded EXIF
      const exifObj = { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {} };
      exifObj['0th'][piexif.ImageIFD.Make] = 'Test Cam';
      const exifBytes = piexif.dump(exifObj);
      const base = fs.readFileSync(sampleJpegPath);
      const withExif = Buffer.from(piexif.insert(exifBytes, base.toString('binary')), 'binary');

      const tool = tools['strip-metadata'];
      expect(tool).toBeDefined();

      const result = await tool.handler(
        { image: { kind: 'base64', data: withExif.toString('base64') } },
        { request: {} }
      );

      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.removed).toContain('exif');
      expect(parsed.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
      expect(parsed.sizeAfter).toBeLessThan(parsed.sizeBefore);
    });
  });

  describe('edit-exif tool', () => {
    it('edits fields and returns an updated data URL', async () => {
      const tool = tools['edit-exif'];
      expect(tool).toBeDefined();

      const result = await tool.handler(
        {
          image: { kind: 'path', path: sampleJpegPath },
          fields: { Make: 'Edited Cam', Model: 'M1' }
        },
        { request: {} }
      );

      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.changed).toContain('Make');
      expect(parsed.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
    });
  });
});
