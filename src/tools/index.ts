import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import exifr from 'exifr';
import { loadImage } from './loaders.js';
import { 
  buildOptions, 
  buildExifOptions, 
  buildXmpOptions, 
  buildSegmentOptions 
} from './segments.js';
import { 
  ImageSourceType
} from '../types/image.js';
import { stripImage } from '../web/image.js';
import { editImage } from '../web/edit.js';
import { z } from 'zod';

/**
 * Helper function to standardize successful MCP responses
 */
function createSuccessResponse(data: any) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }
    ]
  };
}

/**
 * Helper function to standardize MCP error responses
 */
function createErrorResponse(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: message
      }
    ],
    isError: true
  };
}

/**
 * Registers all exif-mcp tools with the MCP server
 * @param server The MCP server instance
 * @returns Object with references to all registered tools for testing
 */
export function registerTools(server: McpServer): Record<string, any> {
  // Store references to all tools for testing
  const tools: Record<string, any> = {};
  
  // Define a Zod schema for the ImageSource type that's directly usable with McpServer.tool
  const ImageSourceSchema = z.object({
    kind: z.enum(['path', 'url', 'base64', 'buffer']),
    path: z.string().optional(),
    url: z.string().optional(),
    data: z.string().optional(),
    buffer: z.string().optional()
  });

  // Tool 1: read-metadata - reads all or specified metadata segments from an image
  const readMetadataTool = server.tool('read-metadata', 
    "Read all or specified metadata segments from an image",
    {
      image: ImageSourceSchema,
      segments: z.array(z.enum(['EXIF', 'GPS', 'XMP', 'ICC', 'IPTC', 'JFIF', 'IHDR'])).optional()
    },
    async (args, extra) => {
      try {
        const { image, segments } = args;
        const buf = await loadImage(image);
        const opts = buildOptions(segments as any);
        const meta = await exifr.parse(buf, opts);
        
        if (!meta || Object.keys(meta).length === 0) {
          return createErrorResponse('No metadata found in image');
        }
        
        return createSuccessResponse(meta);
      } catch (error) {
        return createErrorResponse(`Error reading metadata: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['read-metadata'] = readMetadataTool;

  // Tool 2: read-exif - reads EXIF data specifically
  const readExifTool = server.tool('read-exif',
    "Read EXIF data from an image with optional tag filtering",
    {
      image: ImageSourceSchema,
      pick: z.array(z.string()).optional()
    },
    async (args, extra) => {
      try {
        const { image, pick } = args;
        const buf = await loadImage(image);
        const opts = buildExifOptions(pick);
        const meta = await exifr.parse(buf, opts);
        
        if (!meta || Object.keys(meta).length === 0) {
          return createErrorResponse('No EXIF metadata found in image');
        }
        
        return createSuccessResponse(meta);
      } catch (error) {
        return createErrorResponse(`Error reading EXIF data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['read-exif'] = readExifTool;

  // Tool 3: read-xmp - reads XMP data
  const readXmpTool = server.tool('read-xmp',
    "Read XMP metadata from an image with option for extended XMP segments",
    {
      image: ImageSourceSchema,
      extended: z.boolean().optional()
    },
    async (args, extra) => {
      try {
        const { image, extended } = args;
        const buf = await loadImage(image);
        const opts = buildXmpOptions(extended);
        const meta = await exifr.parse(buf, opts);
        
        if (!meta || !meta.xmp) {
          return createErrorResponse('No XMP metadata found in image');
        }
        
        return createSuccessResponse(meta);
      } catch (error) {
        return createErrorResponse(`Error reading XMP data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['read-xmp'] = readXmpTool;

  // Tools 4-7: Segment-specific tools (ICC, IPTC, JFIF, IHDR)
  const segmentTools = [
    { name: 'read-icc', segment: 'ICC' },
    { name: 'read-iptc', segment: 'IPTC' },
    { name: 'read-jfif', segment: 'JFIF' },
    { name: 'read-ihdr', segment: 'IHDR' }
  ] as const;

  segmentTools.forEach(({ name, segment }) => {
    const segmentTool = server.tool(name,
      `Read ${segment} metadata from an image`,
      {
        image: ImageSourceSchema
      },
      async (args, extra) => {
        try {
          const { image } = args;
          const buf = await loadImage(image);
          const opts = buildSegmentOptions(segment);
          const meta = await exifr.parse(buf, opts);
          
          const segmentKey = segment.toLowerCase();
          if (!meta || !meta[segmentKey]) {
            return createErrorResponse(`No ${segment} metadata found in image`);
          }
          
          return createSuccessResponse(meta);
        } catch (error) {
          return createErrorResponse(`Error reading ${segment} data: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    );
    tools[name] = segmentTool;
  });

  // Tool 8: orientation - gets image orientation
  const orientationTool = server.tool('orientation',
    "Get image orientation value (1-8)",
    {
      image: ImageSourceSchema
    },
    async (args, extra) => {
      try {
        const { image } = args;
        const buf = await loadImage(image);
        const orientation = await exifr.orientation(buf);
        
        if (orientation === undefined) {
          return createErrorResponse('No orientation metadata found in image');
        }
        
        return createSuccessResponse({ orientation });
      } catch (error) {
        return createErrorResponse(`Error reading orientation: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['orientation'] = orientationTool;

  // Tool 9: rotation-info - gets rotation and flip information
  const rotationInfoTool = server.tool('rotation-info',
    "Get detailed rotation and flip information from image orientation",
    {
      image: ImageSourceSchema
    },
    async (args, extra) => {
      try {
        const { image } = args;
        const buf = await loadImage(image);
        const rotation = await exifr.rotation(buf);
        
        if (!rotation) {
          return createErrorResponse('No rotation metadata found in image');
        }
        
        return createSuccessResponse(rotation);
      } catch (error) {
        return createErrorResponse(`Error reading rotation info: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['rotation-info'] = rotationInfoTool;

  // Tool 10: gps-coordinates - extracts GPS coordinates
  const gpsCoordinatesTool = server.tool('gps-coordinates',
    "Extract GPS coordinates (latitude/longitude) from image metadata",
    {
      image: ImageSourceSchema
    },
    async (args, extra) => {
      try {
        const { image } = args;
        const buf = await loadImage(image);
        const gps = await exifr.gps(buf);
        
        return createSuccessResponse(gps || null);
      } catch (error) {
        return createErrorResponse(`Error reading GPS data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['gps-coordinates'] = gpsCoordinatesTool;

  // Tool 10.5: strip-metadata - removes all metadata from an image
  const stripMetadataTool = server.tool('strip-metadata',
    "Remove all metadata (EXIF, GPS, XMP, ICC, IPTC) from an image losslessly. Supports JPEG and PNG.",
    {
      image: ImageSourceSchema
    },
    async (args, extra) => {
      try {
        const { image } = args;
        const result = await stripImage(image);
        return createSuccessResponse({
          removed: result.removed,
          format: result.format,
          mime: result.mime,
          sizeBefore: result.sizeBefore,
          sizeAfter: result.sizeAfter,
          dataUrl: `data:${result.mime};base64,${Buffer.from(result.data).toString('base64')}`
        });
      } catch (error) {
        return createErrorResponse(`Error stripping metadata: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['strip-metadata'] = stripMetadataTool;

  // Tool 10.75: edit-exif - edits EXIF/GPS fields in a JPEG
  const editExifTool = server.tool('edit-exif',
    "Edit EXIF and GPS fields in a JPEG image. Returns the modified image as a base64 data URL.",
    {
      image: ImageSourceSchema,
      fields: z.object({
        Make: z.string().optional(),
        Model: z.string().optional(),
        Software: z.string().optional(),
        Artist: z.string().optional(),
        Copyright: z.string().optional(),
        ImageDescription: z.string().optional(),
        DateTime: z.string().optional(),
        DateTimeOriginal: z.string().optional(),
        DateTimeDigitized: z.string().optional(),
        UserComment: z.string().optional()
      }).optional(),
      gps: z.object({
        latitude: z.number(),
        longitude: z.number()
      }).optional(),
      clearGps: z.boolean().optional()
    },
    async (args, extra) => {
      try {
        const { image, fields, gps, clearGps } = args;
        const result = await editImage(image, { fields, gps, clearGps });
        return createSuccessResponse({
          changed: result.changed,
          mime: result.mime,
          dataUrl: `data:${result.mime};base64,${Buffer.from(result.data).toString('base64')}`
        });
      } catch (error) {
        return createErrorResponse(`Error editing EXIF data: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['edit-exif'] = editExifTool;

  // Tool 11: thumbnail - extracts embedded thumbnail
  const thumbnailTool = server.tool('thumbnail',
    "Extract embedded thumbnail from image as base64 data or URL",
    {
      image: ImageSourceSchema,
      url: z.boolean().optional()
    },
    async (args, extra) => {
      try {
        const { image, url } = args;
        const buf = await loadImage(image);
        const thumbnail = await exifr.thumbnail(buf);
        
        if (!thumbnail) {
          return createErrorResponse('No thumbnail found in image');
        }
        
        // Convert to base64 data URL by default
        if (!url) {
          const base64 = Buffer.from(thumbnail).toString('base64');
          const mimeType = 'image/jpeg'; // Thumbnails are typically JPEG
          const dataUrl = `data:${mimeType};base64,${base64}`;
          return createSuccessResponse({ dataUrl });
        }
        
        // For browsers, object URLs would be created, but we can't do that in Node
        // So we'll just return the base64 data
        const base64 = Buffer.from(thumbnail).toString('base64');
        return createSuccessResponse({ base64 });
      } catch (error) {
        return createErrorResponse(`Error extracting thumbnail: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
  tools['thumbnail'] = thumbnailTool;

  return tools;
}
