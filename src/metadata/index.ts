import { CheerioAPI } from 'cheerio'
import { load } from 'cheerio'
import { logger } from '../logger'
import { ErrorCode } from '../types'
import { SiteFetchError } from '../errors'

/**
 * Error thrown when metadata extraction fails
 */
export class MetadataError extends SiteFetchError {
  constructor(message: string) {
    super(message, ErrorCode.METADATA_ERROR)
    this.name = 'MetadataError'
  }
}

/**
 * Options for metadata extraction
 */
export interface MetadataOptions {
  /** Whether to extract publication dates */
  extractDates?: boolean
  /** Whether to extract author information */
  extractAuthors?: boolean
  /** Whether to extract meta tags */
  extractMetaTags?: boolean
  /** Whether to extract OpenGraph metadata */
  extractOpenGraph?: boolean
  /** Whether to extract Twitter card metadata */
  extractTwitterCard?: boolean
  /** Whether to extract JSON-LD structured data */
  extractJsonLd?: boolean
  /** Whether to extract microdata from HTML attributes */
  extractMicrodata?: boolean
  /** Custom metadata extractors */
  customExtractors?: Array<(
    $: CheerioAPI, 
    url: string
  ) => Record<string, any> | Promise<Record<string, any>>>
}

/**
 * Default metadata options
 */
const DEFAULT_METADATA_OPTIONS: MetadataOptions = {
  extractDates: true,
  extractAuthors: true,
  extractMetaTags: true,
  extractOpenGraph: true,
  extractTwitterCard: true,
  extractJsonLd: true,
  extractMicrodata: false, // More complex, disabled by default
}

/**
 * Common date patterns to look for in HTML
 */
const DATE_PATTERNS = [
  // ISO dates (2023-01-15T12:00:00Z)
  /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/i,
  // Common date formats (15 January 2023, Jan 15, 2023, etc.)
  /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/i,
  /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/i,
  // Short dates (MM/DD/YYYY or DD/MM/YYYY)
  /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
]

/**
 * Class for extracting metadata from web pages
 */
export class MetadataExtractor {
  private options: MetadataOptions

  /**
   * Creates a new metadata extractor
   * 
   * @param options Extraction options
   */
  constructor(options: MetadataOptions = {}) {
    this.options = { ...DEFAULT_METADATA_OPTIONS, ...options }
  }

  /**
   * Extract metadata from HTML content
   * 
   * @param html HTML content to extract from
   * @param url URL of the page (for context)
   * @returns Extracted metadata
   */
  extract(html: string, url: string): Record<string, any> {
    try {
      const $ = load(html)
      return this.extractFromCheerio($, url)
    } catch (error) {
      logger.warn(`Failed to extract metadata from ${url}: ${error.message}`)
      throw new MetadataError(`Failed to extract metadata from ${url}: ${error.message}`)
    }
  }

  /**
   * Extract metadata from a Cheerio instance
   * 
   * @param $ Cheerio instance
   * @param url URL of the page (for context)
   * @returns Extracted metadata
   */
  extractFromCheerio($: CheerioAPI, url: string): Record<string, any> {
    const metadata: Record<string, any> = {}

    // Run each enabled extractor
    if (this.options.extractDates) {
      metadata.dates = this.extractDates($, url)
    }

    if (this.options.extractAuthors) {
      metadata.authors = this.extractAuthors($, url)
    }

    if (this.options.extractMetaTags) {
      metadata.meta = this.extractMetaTags($)
    }

    if (this.options.extractOpenGraph) {
      metadata.openGraph = this.extractOpenGraph($)
    }

    if (this.options.extractTwitterCard) {
      metadata.twitterCard = this.extractTwitterCard($)
    }

    if (this.options.extractJsonLd) {
      metadata.jsonLd = this.extractJsonLd($)
    }

    if (this.options.extractMicrodata) {
      metadata.microdata = this.extractMicrodata($)
    }

    // Run custom extractors if provided
    if (this.options.customExtractors) {
      for (let i = 0; i < this.options.customExtractors.length; i++) {
        try {
          const customExtractor = this.options.customExtractors[i]
          const customData = customExtractor($, url)
          
          metadata[`custom${i + 1}`] = customData
        } catch (error) {
          logger.warn(`Custom extractor ${i + 1} failed: ${error.message}`)
        }
      }
    }

    return metadata
  }

  /**
   * Extract publication dates from the page
   * 
   * @param $ Cheerio instance
   * @param url URL of the page
   * @returns Extracted dates
   */
  private extractDates($: CheerioAPI, url: string): {
    published?: string
    modified?: string
    detected?: string[]
  } {
    const result: {
      published?: string
      modified?: string
      detected?: string[]
    } = {
      detected: []
    }

    // Check meta tags for publication dates
    const publishedTime = $('meta[property="article:published_time"]').attr('content') ||
                         $('meta[name="publication-date"]').attr('content') ||
                         $('meta[name="date"]').attr('content') ||
                         $('meta[name="published-date"]').attr('content')
    
    if (publishedTime) {
      try {
        const date = new Date(publishedTime)
        if (!isNaN(date.getTime())) {
          result.published = date.toISOString()
          result.detected.push(result.published)
        }
      } catch (error) {
        // Ignore invalid dates
      }
    }

    // Check meta tags for modified dates
    const modifiedTime = $('meta[property="article:modified_time"]').attr('content') ||
                        $('meta[name="last-modified"]').attr('content') ||
                        $('meta[name="modified-date"]').attr('content')
    
    if (modifiedTime) {
      try {
        const date = new Date(modifiedTime)
        if (!isNaN(date.getTime())) {
          result.modified = date.toISOString()
          result.detected.push(result.modified)
        }
      } catch (error) {
        // Ignore invalid dates
      }
    }

    // Look for time elements with datetime attributes
    $('time[datetime]').each((_, el) => {
      const datetime = $(el).attr('datetime')
      
      if (datetime) {
        try {
          const date = new Date(datetime)
          if (!isNaN(date.getTime())) {
            const isoDate = date.toISOString()
            
            if (!result.detected.includes(isoDate)) {
              result.detected.push(isoDate)
              
              // Use first date as published date if none found yet
              if (!result.published) {
                result.published = isoDate
              }
            }
          }
        } catch (error) {
          // Ignore invalid dates
        }
      }
    })

    // Look for dates in the text
    const bodyText = $('body').text()
    
    for (const pattern of DATE_PATTERNS) {
      const matches = bodyText.match(new RegExp(pattern, 'g'))
      
      if (matches) {
        for (const match of matches) {
          try {
            const date = new Date(match)
            
            if (!isNaN(date.getTime())) {
              const isoDate = date.toISOString()
              
              if (!result.detected.includes(isoDate)) {
                result.detected.push(isoDate)
              }
            }
          } catch (error) {
            // Ignore invalid dates
          }
        }
      }
    }

    // If we found dates but no explicit published date, use the earliest date
    if (result.detected.length > 0 && !result.published) {
      const dates = result.detected.map(d => new Date(d).getTime())
      const earliestDate = new Date(Math.min(...dates))
      result.published = earliestDate.toISOString()
    }

    return result
  }

  /**
   * Extract author information from the page
   * 
   * @param $ Cheerio instance
   * @param url URL of the page
   * @returns Extracted author information
   */
  private extractAuthors($: CheerioAPI, url: string): {
    names?: string[]
    links?: string[]
  } {
    const result: {
      names?: string[]
      links?: string[]
    } = {
      names: [],
      links: []
    }

    // Check meta tags for author information
    const metaAuthor = $('meta[name="author"]').attr('content') ||
                      $('meta[property="article:author"]').attr('content')
    
    if (metaAuthor) {
      result.names.push(metaAuthor)
    }

    // Check rel="author" links
    $('a[rel="author"]').each((_, el) => {
      const $el = $(el)
      const name = $el.text().trim()
      const link = $el.attr('href')
      
      if (name && !result.names.includes(name)) {
        result.names.push(name)
      }
      
      if (link) {
        try {
          const authorUrl = new URL(link, url).href
          if (!result.links.includes(authorUrl)) {
            result.links.push(authorUrl)
          }
        } catch (error) {
          // Ignore invalid URLs
        }
      }
    })

    // Check common author selectors
    const authorSelectors = [
      '.author',
      '.byline',
      '.byline-name',
      '[itemprop="author"]',
      '.article-author',
      '.post-author',
      '.entry-author'
    ]

    for (const selector of authorSelectors) {
      $(selector).each((_, el) => {
        const $el = $(el)
        let authorName: string | undefined
        
        // Check for nested itemprop="name"
        const nameEl = $el.find('[itemprop="name"]')
        
        if (nameEl.length) {
          authorName = nameEl.text().trim()
        } else {
          authorName = $el.text().trim()
        }

        if (authorName && !result.names.includes(authorName) && authorName.length < 100) {
          result.names.push(authorName)
        }

        // Look for links
        const authorLink = $el.find('a').attr('href')
        
        if (authorLink) {
          try {
            const authorUrl = new URL(authorLink, url).href
            if (!result.links.includes(authorUrl)) {
              result.links.push(authorUrl)
            }
          } catch (error) {
            // Ignore invalid URLs
          }
        }
      })
    }

    return result
  }

  /**
   * Extract meta tags from the page
   * 
   * @param $ Cheerio instance
   * @returns Extracted meta tags
   */
  private extractMetaTags($: CheerioAPI): Record<string, string> {
    const metaTags: Record<string, string> = {}

    $('meta').each((_, el) => {
      const $el = $(el)
      
      // Get meta name/property and content
      const name = $el.attr('name') || $el.attr('property') || $el.attr('http-equiv')
      const content = $el.attr('content')
      
      if (name && content) {
        metaTags[name] = content
      }
    })

    return metaTags
  }

  /**
   * Extract OpenGraph metadata from the page
   * 
   * @param $ Cheerio instance
   * @returns Extracted OpenGraph metadata
   */
  private extractOpenGraph($: CheerioAPI): Record<string, string> {
    const og: Record<string, string> = {}

    $('meta[property^="og:"]').each((_, el) => {
      const $el = $(el)
      const property = $el.attr('property')
      const content = $el.attr('content')
      
      if (property && content) {
        // Remove the "og:" prefix
        const key = property.substring(3)
        og[key] = content
      }
    })

    return og
  }

  /**
   * Extract Twitter card metadata from the page
   * 
   * @param $ Cheerio instance
   * @returns Extracted Twitter card metadata
   */
  private extractTwitterCard($: CheerioAPI): Record<string, string> {
    const twitter: Record<string, string> = {}

    $('meta[name^="twitter:"]').each((_, el) => {
      const $el = $(el)
      const name = $el.attr('name')
      const content = $el.attr('content')
      
      if (name && content) {
        // Remove the "twitter:" prefix
        const key = name.substring(8)
        twitter[key] = content
      }
    })

    return twitter
  }

  /**
   * Extract JSON-LD structured data from the page
   * 
   * @param $ Cheerio instance
   * @returns Extracted JSON-LD data
   */
  private extractJsonLd($: CheerioAPI): Array<Record<string, any>> {
    const jsonLdData: Array<Record<string, any>> = []

    $('script[type="application/ld+json"]').each((_, el) => {
      const content = $(el).text()
      
      if (content) {
        try {
          const data = JSON.parse(content.trim())
          jsonLdData.push(data)
        } catch (error) {
          logger.warn(`Failed to parse JSON-LD data: ${error.message}`)
        }
      }
    })

    return jsonLdData
  }

  /**
   * Extract microdata from HTML attributes
   * 
   * @param $ Cheerio instance
   * @returns Extracted microdata
   */
  private extractMicrodata($: CheerioAPI): Array<Record<string, any>> {
    const microdata: Array<Record<string, any>> = []

    // This is a simplified implementation - full microdata extraction
    // would require tree traversal and context tracking
    
    $('[itemtype]').each((_, el) => {
      const $el = $(el)
      const itemType = $el.attr('itemtype')
      const itemId = $el.attr('itemid')
      
      const item: Record<string, any> = {
        type: itemType
      }
      
      if (itemId) {
        item.id = itemId
      }
      
      // Extract properties
      const properties: Record<string, any> = {}
      
      $el.find('[itemprop]').each((_, propEl) => {
        const $propEl = $(propEl)
        const propName = $propEl.attr('itemprop')
        
        if (!propName) return
        
        // Get property value based on element type
        let propValue: any
        
        if ($propEl.is('meta')) {
          propValue = $propEl.attr('content')
        } else if ($propEl.is('img, audio, video, source')) {
          propValue = $propEl.attr('src')
        } else if ($propEl.is('a, link')) {
          propValue = $propEl.attr('href')
        } else if ($propEl.is('time')) {
          propValue = $propEl.attr('datetime') || $propEl.text()
        } else if ($propEl.is('data')) {
          propValue = $propEl.attr('value')
        } else {
          propValue = $propEl.text()
        }
        
        if (propValue) {
          properties[propName] = propValue.trim()
        }
      })
      
      item.properties = properties
      microdata.push(item)
    })

    return microdata
  }

  /**
   * Updates the metadata options
   * 
   * @param options New options
   */
  updateOptions(options: Partial<MetadataOptions>): void {
    this.options = { ...this.options, ...options }
  }
}

/**
 * Creates a metadata extractor with the given options
 * 
 * @param options Extraction options
 * @returns MetadataExtractor instance
 */
export function createMetadataExtractor(options?: MetadataOptions): MetadataExtractor {
  return new MetadataExtractor(options)
}
