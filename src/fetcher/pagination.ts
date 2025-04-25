import { CheerioAPI } from 'cheerio'
import { logger } from '../logger'
import { PaginationOptions, ErrorCode } from '../types'
import { SiteFetchError } from '../errors'

/**
 * Error thrown when pagination detection or handling fails
 */
export class PaginationError extends SiteFetchError {
  constructor(message: string) {
    super(message, ErrorCode.PAGINATION_ERROR)
    this.name = 'PaginationError'
  }
}

/**
 * Common pagination patterns in URLs
 */
const PAGINATION_PATTERNS = {
  // Match: ?page=2, &page=3, /page/2, /p/3
  PAGE_PARAM: /(?:\?|&)page=(\d+)|\/page\/(\d+)|\/p\/(\d+)/i,
  // Match: ?pg=2, &pg=3
  PG_PARAM: /(?:\?|&)pg=(\d+)/i,
  // Match: ?paged=2, &paged=3
  PAGED_PARAM: /(?:\?|&)paged=(\d+)/i,
  // Match: ?offset=10, &offset=20
  OFFSET_PARAM: /(?:\?|&)offset=(\d+)/i,
  // Match: ?start=10, &start=20
  START_PARAM: /(?:\?|&)start=(\d+)/i,
}

/**
 * Common patterns for pagination link text content
 */
const PAGINATION_LINK_TEXT = {
  NEXT: /^\s*(next|next\s*page|›|>|»|forward)\s*$/i,
  PREV: /^\s*(prev|previous|prev\s*page|previous\s*page|‹|<|«|back)\s*$/i,
  // Match page numbers like "Page 2 of 10", "Page 2/10"
  PAGE_X_OF_Y: /page\s*(\d+)(?:\s*of|\s*\/)\s*(\d+)/i,
}

/**
 * Default CSS selectors for pagination elements
 */
const DEFAULT_PAGINATION_SELECTORS = {
  // Common selectors for pagination navigation
  nextLink: [
    '.pagination .next',
    '.pagination .next a',
    'a.next',
    '.pager-next a',
    '.pager-next',
    '.pagination__next',
    '.pagination__next a',
    '.pagination a[rel="next"]',
    'a[rel="next"]',
    '.pagination a:contains("Next")',
    '.pagination a:contains("next")',
    '.pagination a:contains("›")',
    '.pagination a:contains("»")',
    '.pagination a:contains(">")',
    'a.page-link[aria-label="Next"]',
    'nav.navigation.pagination a.next',
  ].join(', '),
  
  // Common selectors for page number links
  pageNumbers: [
    '.pagination a:not(.prev):not(.next)',
    '.pagination a:not(.previous):not(.next)',
    '.pagination__list a',
    '.page-numbers a',
    'a.page-numbers',
    '.pagination li:not(.prev):not(.next) a',
    'nav.navigation.pagination a.page-numbers',
  ].join(', '),
}

/**
 * Class for handling pagination detection and URL extraction
 */
export class PaginationHandler {
  private options: PaginationOptions
  private paginationCache: Map<string, string[]> = new Map()
  
  /**
   * Creates a new pagination handler
   * 
   * @param options Pagination options
   */
  constructor(options: PaginationOptions = {}) {
    this.options = {
      enabled: true,
      maxPages: 10,
      autoDetect: true,
      strategy: 'auto',
      ...options,
      selectors: {
        ...DEFAULT_PAGINATION_SELECTORS,
        ...options.selectors,
      },
    }
  }
  
  /**
   * Detects pagination on a page and returns URLs for next pages
   * 
   * @param $ Cheerio instance loaded with the page HTML
   * @param url Current page URL
   * @param html Raw HTML content
   * @returns Array of pagination URLs found
   */
  async detectPagination($: CheerioAPI, url: string, html: string): Promise<string[]> {
    if (!this.options.enabled) {
      return []
    }
    
    // Check cache first
    const cachedUrls = this.paginationCache.get(url)
    if (cachedUrls) {
      return cachedUrls
    }
    
    let paginationUrls: string[] = []
    const baseUrl = new URL(url)
    const strategy = this.options.strategy || 'auto'
    
    try {
      // Try different strategies based on configuration
      if (strategy === 'auto' || strategy === 'next-link') {
        const nextLinkUrls = this.findNextLinkUrls($, url)
        if (nextLinkUrls.length > 0) {
          paginationUrls = [...paginationUrls, ...nextLinkUrls]
        }
      }
      
      if (strategy === 'auto' || strategy === 'page-numbers') {
        const pageNumberUrls = this.findPageNumberUrls($, url)
        if (pageNumberUrls.length > 0) {
          paginationUrls = [...paginationUrls, ...pageNumberUrls]
        }
      }
      
      // If auto-detection is enabled and we haven't found any URLs, try advanced detection
      if (this.options.autoDetect && paginationUrls.length === 0) {
        paginationUrls = this.autoDetectPaginationUrls($, url, html)
      }
      
      // Filter out duplicate URLs and limit to maxPages
      const uniqueUrls = [...new Set(paginationUrls)]
        .filter(pageUrl => pageUrl !== url) // Don't include the current URL
        .slice(0, this.options.maxPages || 10)
      
      // Apply URL patterns if configured
      if (this.options.urlPatterns) {
        return this.filterUrlsByPatterns(uniqueUrls)
      }
      
      // Cache the results
      this.paginationCache.set(url, uniqueUrls)
      
      return uniqueUrls
    } catch (error) {
      logger.warn(`Pagination detection failed for ${url}: ${error.message}`)
      return []
    }
  }
  
  /**
   * Finds pagination URLs using "next" link selectors
   * 
   * @param $ Cheerio instance
   * @param url Current page URL
   * @returns Array of next page URLs
   */
  private findNextLinkUrls($: CheerioAPI, url: string): string[] {
    const nextLinkSelector = this.options.selectors?.nextLink
    if (!nextLinkSelector) {
      return []
    }
    
    const urls: string[] = []
    
    // Look for elements matching the selector
    $(nextLinkSelector).each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href')
      
      // Skip if no href
      if (!href) {
        return
      }
      
      try {
        // Resolve relative URLs
        const nextUrl = new URL(href, url).href
        
        // Only add if the URL is different from the current one
        if (nextUrl !== url) {
          urls.push(nextUrl)
        }
      } catch (error) {
        logger.warn(`Failed to parse pagination URL: ${href}`)
      }
    })
    
    // Also look for links with "next" text or rel=next
    $('a').each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href')
      const rel = $el.attr('rel')
      const text = $el.text().trim()
      const ariaLabel = $el.attr('aria-label')
      
      if (!href) {
        return
      }
      
      // Check if it's a "next" link
      const isNextLink = 
        rel === 'next' || 
        PAGINATION_LINK_TEXT.NEXT.test(text) ||
        (ariaLabel && PAGINATION_LINK_TEXT.NEXT.test(ariaLabel))
      
      if (isNextLink) {
        try {
          const nextUrl = new URL(href, url).href
          if (nextUrl !== url) {
            urls.push(nextUrl)
          }
        } catch (error) {
          logger.warn(`Failed to parse pagination URL: ${href}`)
        }
      }
    })
    
    return urls
  }
  
  /**
   * Finds pagination URLs using page number selectors
   * 
   * @param $ Cheerio instance
   * @param url Current page URL
   * @returns Array of page number URLs
   */
  private findPageNumberUrls($: CheerioAPI, url: string): string[] {
    const pageNumberSelector = this.options.selectors?.pageNumbers
    if (!pageNumberSelector) {
      return []
    }
    
    const urls: string[] = []
    
    // Look for elements matching the selector
    $(pageNumberSelector).each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href')
      
      // Skip if no href
      if (!href) {
        return
      }
      
      try {
        // Resolve relative URLs
        const pageUrl = new URL(href, url).href
        
        // Only add if the URL is different from the current one
        if (pageUrl !== url) {
          urls.push(pageUrl)
        }
      } catch (error) {
        logger.warn(`Failed to parse pagination URL: ${href}`)
      }
    })
    
    return urls
  }
  
  /**
   * Attempts to auto-detect pagination URLs using heuristics
   * 
   * @param $ Cheerio instance
   * @param url Current page URL
   * @param html Raw HTML content
   * @returns Array of detected pagination URLs
   */
  private autoDetectPaginationUrls($: CheerioAPI, url: string, html: string): string[] {
    const urls: string[] = []
    const currentUrl = new URL(url)
    const currentPath = currentUrl.pathname
    
    // Try to detect pagination URL patterns
    const urlPatterns = this.detectPaginationUrlPatterns(url)
    
    // If we found patterns, generate URLs
    if (urlPatterns.length > 0) {
      // Get current page number
      const currentPage = this.extractPageNumber(url)
      
      // Generate URLs for next few pages
      const maxPagesToGenerate = this.options.maxPages || 10
      
      if (currentPage !== null) {
        for (let i = currentPage + 1; i <= currentPage + maxPagesToGenerate; i++) {
          for (const pattern of urlPatterns) {
            try {
              const nextUrl = pattern.replace('{{page}}', i.toString())
              urls.push(new URL(nextUrl, url).href)
            } catch (error) {
              // Skip invalid URLs
            }
          }
        }
      }
    }
    
    // Look for links with page numbers in their href
    $('a').each((_, el) => {
      const $el = $(el)
      const href = $el.attr('href')
      
      if (!href) {
        return
      }
      
      // Skip anchor links and javascript
      if (href.startsWith('#') || href.startsWith('javascript:')) {
        return
      }
      
      try {
        const linkUrl = new URL(href, url)
        
        // Check if this URL matches pagination patterns
        const isPaginationUrl = 
          PAGINATION_PATTERNS.PAGE_PARAM.test(linkUrl.href) ||
          PAGINATION_PATTERNS.PG_PARAM.test(linkUrl.href) ||
          PAGINATION_PATTERNS.PAGED_PARAM.test(linkUrl.href) ||
          PAGINATION_PATTERNS.OFFSET_PARAM.test(linkUrl.href) ||
          PAGINATION_PATTERNS.START_PARAM.test(linkUrl.href)
        
        if (isPaginationUrl && linkUrl.href !== url) {
          urls.push(linkUrl.href)
        }
      } catch (error) {
        // Skip invalid URLs
      }
    })
    
    return urls
  }
  
  /**
   * Detects pagination URL patterns from the current URL
   * 
   * @param url Current URL
   * @returns Array of URL patterns with {{page}} placeholder
   */
  private detectPaginationUrlPatterns(url: string): string[] {
    const patterns: string[] = []
    const currentUrl = new URL(url)
    
    // Check for page parameter in query string
    for (const [key, value] of currentUrl.searchParams.entries()) {
      if (/^(page|pg|paged|p)$/.test(key) && /^\d+$/.test(value)) {
        const pattern = url.replace(`${key}=${value}`, `${key}={{page}}`)
        patterns.push(pattern)
      }
    }
    
    // Check for page in path
    const pageInPathMatch = 
      currentUrl.pathname.match(/\/page\/(\d+)/) || 
      currentUrl.pathname.match(/\/p\/(\d+)/)
    
    if (pageInPathMatch) {
      const pageNum = pageInPathMatch[1]
      const pattern = url.replace(
        pageInPathMatch[0], 
        pageInPathMatch[0].replace(pageNum, '{{page}}')
      )
      patterns.push(pattern)
    }
    
    return patterns
  }
  
  /**
   * Extracts page number from a URL
   * 
   * @param url URL to analyze
   * @returns Page number or null if not found
   */
  private extractPageNumber(url: string): number | null {
    const urlObj = new URL(url)
    
    // Check query parameters
    const pageParam = urlObj.searchParams.get('page')
    if (pageParam && /^\d+$/.test(pageParam)) {
      return parseInt(pageParam, 10)
    }
    
    const pgParam = urlObj.searchParams.get('pg')
    if (pgParam && /^\d+$/.test(pgParam)) {
      return parseInt(pgParam, 10)
    }
    
    const pagedParam = urlObj.searchParams.get('paged')
    if (pagedParam && /^\d+$/.test(pagedParam)) {
      return parseInt(pagedParam, 10)
    }
    
    // Check URL path
    const pathMatch = 
      urlObj.pathname.match(/\/page\/(\d+)/) || 
      urlObj.pathname.match(/\/p\/(\d+)/)
    
    if (pathMatch) {
      return parseInt(pathMatch[1], 10)
    }
    
    return null
  }
  
  /**
   * Filters URLs based on configured patterns
   * 
   * @param urls List of URLs to filter
   * @returns Filtered list of URLs
   */
  private filterUrlsByPatterns(urls: string[]): string[] {
    // If no patterns defined, return all URLs
    if (!this.options.urlPatterns) {
      return urls
    }
    
    return urls.filter(url => {
      // Check exclude patterns first
      if (this.options.urlPatterns?.exclude) {
        for (const pattern of this.options.urlPatterns.exclude) {
          if (pattern.test(url)) {
            return false
          }
        }
      }
      
      // If no match patterns, include all non-excluded URLs
      if (!this.options.urlPatterns?.match) {
        return true
      }
      
      // Check if URL matches any pattern
      for (const pattern of this.options.urlPatterns.match) {
        if (pattern.test(url)) {
          return true
        }
      }
      
      // If match patterns exist but none matched, exclude the URL
      return false
    })
  }
  
  /**
   * Extracts pagination metadata from a page
   * 
   * @param $ Cheerio instance
   * @param url Current page URL
   * @returns Pagination metadata object
   */
  extractPaginationMetadata($: CheerioAPI, url: string): {
    pageNumber?: number;
    totalPages?: number;
    nextPageUrl?: string;
    prevPageUrl?: string;
  } {
    const metadata: {
      pageNumber?: number;
      totalPages?: number;
      nextPageUrl?: string;
      prevPageUrl?: string;
    } = {}
    
    // Try to get current page number
    metadata.pageNumber = this.extractPageNumber(url)
    
    // Find next page URL
    const nextLinks = this.findNextLinkUrls($, url)
    if (nextLinks.length > 0) {
      metadata.nextPageUrl = nextLinks[0]
    }
    
    // Find prev page URL by looking for rel="prev" or "previous" links
    $('a[rel="prev"], a[rel="previous"]').each((_, el) => {
      const href = $(el).attr('href')
      if (href) {
        try {
          metadata.prevPageUrl = new URL(href, url).href
        } catch (error) {
          // Skip invalid URLs
        }
      }
    })
    
    // Also look for links with "prev" or "previous" text
    if (!metadata.prevPageUrl) {
      $('a').each((_, el) => {
        const $el = $(el)
        const href = $el.attr('href')
        const text = $el.text().trim()
        const ariaLabel = $el.attr('aria-label')
        
        if (!href) {
          return
        }
        
        // Check if it's a "prev" link
        const isPrevLink = 
          PAGINATION_LINK_TEXT.PREV.test(text) ||
          (ariaLabel && PAGINATION_LINK_TEXT.PREV.test(ariaLabel))
        
        if (isPrevLink) {
          try {
            metadata.prevPageUrl = new URL(href, url).href
          } catch (error) {
            // Skip invalid URLs
          }
        }
      })
    }
    
    // Try to determine total pages
    // Look for text like "Page X of Y" or "X of Y pages"
    const pageText = $('body').text()
    const pageOfMatch = pageText.match(/page\s*(\d+)\s*of\s*(\d+)/i) || 
                        pageText.match(/(\d+)\s*of\s*(\d+)\s*pages/i)
    
    if (pageOfMatch) {
      metadata.totalPages = parseInt(pageOfMatch[2], 10)
      
      // If pageNumber is not already set, use the first matched number
      if (metadata.pageNumber === null) {
        metadata.pageNumber = parseInt(pageOfMatch[1], 10)
      }
    }
    
    return metadata
  }
  
  /**
   * Clears the pagination cache
   */
  clearCache(): void {
    this.paginationCache.clear()
  }
}
