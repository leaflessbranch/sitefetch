import { ContentTransformer } from './index'
import { TransformOptions } from '../types'
import { load } from 'cheerio'

/**
 * HTML transformer (cleans and formats HTML)
 */
export class HtmlTransformer implements ContentTransformer {
  /**
   * Clean and transform HTML content
   * 
   * @param html HTML content to transform
   * @param options Transformation options
   * @returns Cleaned HTML content
   */
  transform(html: string, options?: TransformOptions): string {
    // Load the HTML with cheerio
    const $ = load(html, { 
      decodeEntities: false,
      xmlMode: options?.xmlMode
    })
    
    // Remove unwanted elements based on options
    if (options?.removeScripts) {
      $('script').remove()
    }
    
    if (options?.removeStyles) {
      $('style').remove()
    }
    
    if (options?.removeComments) {
      $('*').contents().each((_, el) => {
        if (el.type === 'comment') {
          $(el).remove()
        }
      })
    }
    
    // Remove all style attributes
    if (options?.removeInlineStyles) {
      $('[style]').removeAttr('style')
    }
    
    // Remove all class attributes
    if (options?.removeClasses) {
      $('[class]').removeAttr('class')
    }
    
    // Remove data attributes
    if (options?.removeDataAttributes) {
      $('*').each((_, el) => {
        const $el = $(el)
        
        Object.keys(el.attribs || {})
          .filter(attr => attr.startsWith('data-'))
          .forEach(attr => $el.removeAttr(attr))
      })
    }
    
    // Remove event handlers
    if (options?.removeEventHandlers) {
      $('*').each((_, el) => {
        const $el = $(el)
        
        Object.keys(el.attribs || {})
          .filter(attr => attr.startsWith('on'))
          .forEach(attr => $el.removeAttr(attr))
      })
    }
    
    // Remove forms and inputs if requested
    if (options?.removeForms) {
      $('form, input, button, textarea, select').remove()
    }
    
    // Clean up whitespace
    if (options?.prettyPrint) {
      // Pretty print the HTML
      return $.html({ indent: true })
    }
    
    // Get the HTML content
    let result = $.html()
    
    // Remove excessive whitespace if requested
    if (options?.removeExcessWhitespace) {
      result = result.replace(/>\s+</g, '><').trim()
    }
    
    return result
  }
  
  /**
   * Get the name of the transformer
   * 
   * @returns Transformer name
   */
  getName(): string {
    return 'html'
  }
}
