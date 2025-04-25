import { ContentTransformer } from './index'
import { TransformOptions } from '../types'
import { load } from 'cheerio'

/**
 * HTML to plain text transformer
 */
export class TextTransformer implements ContentTransformer {
  /**
   * Transform HTML content to plain text
   * 
   * @param html HTML content to transform
   * @param options Transformation options
   * @returns Plain text content
   */
  transform(html: string, options?: TransformOptions): string {
    // Load the HTML with cheerio
    const $ = load(html)
    
    // Replace heading elements with text versions
    $('h1, h2, h3, h4, h5, h6').each((_, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const level = parseInt(el.tagName.substring(1), 10)
      
      // Format headings based on their level
      if (options?.plainTextHeadings) {
        const prefix = '#'.repeat(level) + ' '
        $el.text(`${prefix}${text}`)
      } else {
        // Just keep the text
        $el.text(text)
      }
    })
    
    // Handle lists
    $('ul, ol').each((_, el) => {
      const $el = $(el)
      const listItems = $el.find('li')
      
      listItems.each((i, li) => {
        const $li = $(li)
        const prefix = el.tagName === 'ol' ? `${i + 1}. ` : '• '
        $li.text(`${prefix}${$li.text().trim()}`)
      })
    })
    
    // Handle links
    if (options?.includeLinks) {
      $('a').each((_, el) => {
        const $el = $(el)
        const text = $el.text().trim()
        const href = $el.attr('href')
        
        if (href && text) {
          $el.text(`${text} [${href}]`)
        }
      })
    }
    
    // Handle blockquotes
    $('blockquote').each((_, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      $el.text(`> ${text.replace(/\n/g, '\n> ')}`)
    })
    
    // Get the text content
    let text = $('body').text()
    
    // Post-processing
    if (options?.removeExcessWhitespace) {
      // Reduce multiple whitespace to single space
      text = text.replace(/\s+/g, ' ')
    }
    
    if (options?.removeLineBreaks) {
      // Reduce multiple line breaks to at most two
      text = text.replace(/\n{3,}/g, '\n\n')
    } else {
      // Preserve paragraphs with double line breaks
      text = text.replace(/<\/p>\s*<p>/g, '\n\n')
    }
    
    // Trim the result
    return text.trim()
  }
  
  /**
   * Get the name of the transformer
   * 
   * @returns Transformer name
   */
  getName(): string {
    return 'text'
  }
}
