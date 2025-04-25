import { logger } from '../logger'
import { Page, TransformOptions } from '../types'

/**
 * Interface for content transformers
 */
export interface ContentTransformer {
  /**
   * Transform HTML content into another format
   * 
   * @param html HTML content to transform
   * @param options Transformation options
   * @returns Transformed content
   */
  transform(html: string, options?: TransformOptions): string
  
  /**
   * Get the name of the transformer
   * 
   * @returns Transformer name
   */
  getName(): string
}

/**
 * Factory for content transformers
 */
export class TransformerFactory {
  private static transformers: Map<string, ContentTransformer> = new Map()
  
  /**
   * Register a transformer
   * 
   * @param name Transformer name
   * @param transformer Transformer implementation
   */
  static register(name: string, transformer: ContentTransformer): void {
    this.transformers.set(name.toLowerCase(), transformer)
  }
  
  /**
   * Get a transformer by name
   * 
   * @param name Transformer name
   * @returns Transformer implementation or undefined if not found
   */
  static getTransformer(name: string): ContentTransformer | undefined {
    return this.transformers.get(name.toLowerCase())
  }
  
  /**
   * Get all registered transformers
   * 
   * @returns Map of all transformers
   */
  static getAllTransformers(): Map<string, ContentTransformer> {
    return this.transformers
  }
  
  /**
   * Transform content using a specific transformer
   * 
   * @param html HTML content to transform
   * @param transformerName Name of the transformer to use
   * @param options Transformation options
   * @returns Transformed content or original HTML if transformer not found
   */
  static transform(html: string, transformerName: string, options?: TransformOptions): string {
    const transformer = this.getTransformer(transformerName)
    
    if (!transformer) {
      logger.warn(`Transformer '${transformerName}' not found, returning original content`)
      return html
    }
    
    return transformer.transform(html, options)
  }
}

/**
 * Get all available output formats
 * 
 * @returns Array of available output format names
 */
export function getAvailableOutputFormats(): string[] {
  return Array.from(TransformerFactory.getAllTransformers().keys())
}

/**
 * Serialize pages into a specific format
 * 
 * @param pages Pages to serialize
 * @param format Output format
 * @param options Transformation options
 * @returns Serialized content
 */
export function serializePages(
  pages: Map<string, Page>,
  format: string = 'text',
  options?: TransformOptions
): string {
  // Return JSON format (special case)
  if (format.toLowerCase() === 'json') {
    return JSON.stringify([...pages.values()], null, options?.prettyPrint ? 2 : 0)
  }
  
  // For XML format (special case)
  if (format.toLowerCase() === 'xml') {
    const xmlContent = [...pages.values()]
      .map((page) =>
        `<page>
  <title>${escapeXml(page.title)}</title>
  <url>${escapeXml(page.url)}</url>
  <content>${escapeXml(page.content)}</content>
  ${page.fetchedAt ? `<fetchedAt>${page.fetchedAt.toISOString()}</fetchedAt>` : ''}
  ${page.statusCode ? `<statusCode>${page.statusCode}</statusCode>` : ''}
</page>`.trim()
      )
      .join('\n\n')
      
    return `<?xml version="1.0" encoding="UTF-8"?>
<pages>
${xmlContent}
</pages>`
  }
  
  // For CSV format (special case)
  if (format.toLowerCase() === 'csv') {
    const header = 'title,url,content\n'
    const csvRows = [...pages.values()]
      .map((page) => 
        `"${escapeCsv(page.title)}","${escapeCsv(page.url)}","${escapeCsv(page.content)}"`
      )
      .join('\n')
    
    return header + csvRows
  }
  
  // Standard text output with page separations
  if (format.toLowerCase() === 'text') {
    return [...pages.values()]
      .map((page) =>
        `<page>
  <title>${page.title}</title>
  <url>${page.url}</url>
  <content>${page.content}</content>
</page>`.trim()
      )
      .join('\n\n')
  }
  
  // For any other format, try to find a transformer
  const transformer = TransformerFactory.getTransformer(format)
  
  if (!transformer) {
    logger.warn(`Output format '${format}' not supported, using default text format`)
    return serializePages(pages, 'text', options)
  }
  
  // Use the transformer for each page's content
  const transformedPages = [...pages.values()].map(page => {
    return {
      ...page,
      content: transformer.transform(page.content, options)
    }
  })
  
  // Return as text with page separations
  return transformedPages
    .map((page) =>
      `<page>
  <title>${page.title}</title>
  <url>${page.url}</url>
  <content>${page.content}</content>
</page>`.trim()
    )
    .join('\n\n')
}

/**
 * Escape special characters for XML
 * 
 * @param text Text to escape
 * @returns Escaped text
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Escape special characters for CSV
 * 
 * @param text Text to escape
 * @returns Escaped text
 */
function escapeCsv(text: string): string {
  return text.replace(/"/g, '""')
}

// Import and register all transformers
import { MarkdownTransformer } from './markdown'
import { TextTransformer } from './text'
import { HtmlTransformer } from './html'

// Register default transformers
TransformerFactory.register('markdown', new MarkdownTransformer())
TransformerFactory.register('text', new TextTransformer())
TransformerFactory.register('html', new HtmlTransformer())
