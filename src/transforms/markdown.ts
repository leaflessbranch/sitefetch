import Turndown from 'turndown'
import { gfm } from 'turndown-plugin-gfm'
import { ContentTransformer } from './index'
import { TransformOptions } from '../types'

/**
 * HTML to Markdown transformer
 */
export class MarkdownTransformer implements ContentTransformer {
  private turndown: Turndown
  
  /**
   * Creates a new markdown transformer
   */
  constructor() {
    this.turndown = new Turndown({
      headingStyle: 'atx',      // Use # style headings
      codeBlockStyle: 'fenced', // Use ``` style code blocks
      emDelimiter: '*',         // Use * for emphasis
      strongDelimiter: '**',    // Use ** for strong
    })
    
    // Add GitHub Flavored Markdown plugin
    this.turndown.use(gfm)
    
    // Custom rules
    this.turndown.addRule('horizontalRule', {
      filter: 'hr',
      replacement: function() {
        return '\n\n---\n\n'
      }
    })
  }
  
  /**
   * Transform HTML content to Markdown
   * 
   * @param html HTML content to transform
   * @param options Transformation options
   * @returns Markdown content
   */
  transform(html: string, options?: TransformOptions): string {
    // Apply custom options if provided
    if (options) {
      if (options.headingStyle) {
        this.turndown.options.headingStyle = options.headingStyle as any
      }
      
      if (options.codeBlockStyle) {
        this.turndown.options.codeBlockStyle = options.codeBlockStyle as any
      }
      
      if (options.bulletListMarker) {
        this.turndown.options.bulletListMarker = options.bulletListMarker
      }
      
      // Apply list spacing options
      if (options.listItemSpacing !== undefined) {
        this.turndown.options.blankBeforeBlockquote = options.listItemSpacing
        this.turndown.options.blankAfterBlockquote = options.listItemSpacing
      }
    }
    
    // Convert to markdown
    let markdown = this.turndown.turndown(html)
    
    // Additional post-processing
    if (options?.removeLineBreaks) {
      markdown = markdown.replace(/\n{3,}/g, '\n\n')
    }
    
    if (options?.removeExcessWhitespace) {
      markdown = markdown.replace(/[ \t]+/g, ' ').trim()
    }
    
    return markdown
  }
  
  /**
   * Get the name of the transformer
   * 
   * @returns Transformer name
   */
  getName(): string {
    return 'markdown'
  }
}
