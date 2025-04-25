import Queue from 'p-queue'
import { Window } from 'happy-dom'
import { Readability } from '@mozilla/readability'
import c from 'picocolors'
import { load } from 'cheerio'
import { logger } from '../logger'
import { toMarkdown } from '../to-markdown'
import { matchPath } from '../utils'
import { PaginationHandler } from './pagination'
import { RateLimiter } from './rate-limiter'
import { RobotsParser } from './robots-parser'
import { ContentFilter } from '../filters'
import { Cache } from '../cache'
import { MetadataExtractor } from '../metadata'
import { handleError, TransformError } from '../errors'
import { RequestManager } from './request-manager'
import { TransformerFactory, serializePages as transformSerializePages } from '../transforms'
import type { Options, FetchSiteResult, Page, TransformOptions } from '../types'

/**
 * Main Fetcher class for SiteFetch
 */
export class Fetcher {
  #pages: FetchSiteResult = new Map()
  #fetched: Set<string> = new Set()
  #queue: Queue
  #paginationHandler: PaginationHandler
  #rateLimiter: RateLimiter
  #contentFilter: ContentFilter
  #cache: Cache
  #metadataExtractor: MetadataExtractor
  #requestManager: RequestManager
  
  /**
   * Creates a new Fetcher instance
   * 
   * @param options Configuration options
   */
  constructor(public options: Options) {
    const concurrency = options.concurrency || 3
    this.#queue = new Queue({ concurrency })
    
    // Initialize pagination handler
    this.#paginationHandler = new PaginationHandler(options.pagination)
    
    // Initialize rate limiter
    this.#rateLimiter = new RateLimiter(options.rateLimit)
    
    // Initialize content filter
    this.#contentFilter = new ContentFilter(options.filter)
    
    // Initialize cache
    this.#cache = new Cache(options.cache)
    
    // Initialize metadata extractor
    this.#metadataExtractor = new MetadataExtractor(options.metadata)
    
    // Initialize request manager
    this.#requestManager = new RequestManager(options.request)
  }
  
  /**
   * Initializes robots.txt parsing for a hostname
   * 
   * @param hostname Hostname to process robots.txt for
   * @private
   */
  async #initRobotsForHost(hostname: string): Promise<void> {
    // Skip if rate limiting is disabled or robots.txt respect is disabled
    if (!this.options.rateLimit?.respectRobotsTxt) {
      return
    }
    
    // Get user agent from options or use default
    const userAgent = this.options.request?.userAgent || 'Sitefetch (https://github.com/egoist/sitefetch)'
    
    // Parse robots.txt and update rate limiter
    await RobotsParser.parseRobotsForHost(hostname, userAgent, this.#rateLimiter)
  }
  
  /**
   * Checks if the limit has been reached
   * 
   * @returns Whether the limit has been reached
   */
  #limitReached() {
    return this.options.limit && this.#pages.size >= this.options.limit
  }
  
  /**
   * Gets the content selector for a pathname
   * 
   * @param pathname Path to get selector for
   * @returns CSS selector string or undefined
   */
  #getContentSelector(pathname: string) {
    if (typeof this.options.contentSelector === 'function')
      return this.options.contentSelector({ pathname })
    
    return this.options.contentSelector
  }
  
  /**
   * Fetches a site starting from a URL
   * 
   * @param url Starting URL
   * @returns Map of pages keyed by pathname
   */
  async fetchSite(url: string): Promise<FetchSiteResult> {
    const startUrl = new URL(url)
    
    logger.info(
      `Started fetching ${c.green(url)} with a concurrency of ${
        this.#queue.concurrency
      }`
    )
    
    // Initialize robots.txt parsing for the target host
    await this.#initRobotsForHost(startUrl.hostname)
    
    await this.#fetchPage(url, {
      skipMatch: true,
    })
    
    await this.#queue.onIdle()
    
    logger.info(
      `Completed fetching ${c.green(url)}. Fetched ${this.#pages.size} pages.`
    )
    
    return this.#pages
  }
  
  /**
   * Fetches a single page and its linked pages
   * 
   * @param url URL to fetch
   * @param options Fetch options
   */
  async #fetchPage(
    url: string,
    options: {
      skipMatch?: boolean
    }
  ) {
    const { host, pathname } = new URL(url)
    
    if (this.#fetched.has(pathname) || this.#limitReached()) {
      return
    }
    
    this.#fetched.add(pathname)
    
    // return if not matched
    // we don't need to extract content for this page
    if (
      !options.skipMatch &&
      this.options.match &&
      !matchPath(pathname, this.options.match)
    ) {
      return
    }
    
    // Try to get from cache first if enabled
    if (this.options.cache?.enabled) {
      try {
        const cachedPage = await this.#cache.get(url)
        if (cachedPage) {
          logger.info(`Using cached page for ${c.green(url)}`)
          
          // Store the cached page in our results
          this.#pages.set(pathname, cachedPage)
          
          // Process links from the cached page if we need to crawl further
          if (options.skipMatch) {
            try {
              const cachedHtml = cachedPage.rawContent || ''
              const $ = load(cachedHtml)
              
              // Extract links for further crawling
              const extraUrls: string[] = []
              
              $('a').each((_, el) => {
                const href = $(el).attr('href')
                
                if (!href) {
                  return
                }
                
                try {
                  const thisUrl = new URL(href, url)
                  if (thisUrl.host !== host) {
                    return
                  }
                  
                  extraUrls.push(thisUrl.href)
                } catch {
                  logger.warn(`Failed to parse URL: ${href}`)
                }
              })
              
              // Add discovered URLs to the queue
              if (extraUrls.length > 0) {
                for (const linkUrl of extraUrls) {
                  this.#queue.add(() =>
                    this.#fetchPage(linkUrl, { ...options, skipMatch: false })
                  )
                }
              }
            } catch (error) {
              logger.warn(`Error processing links from cached page: ${error.message}`)
            }
          }
          
          return
        }
      } catch (error) {
        logger.warn(`Cache error for ${url}: ${error.message}`)
        // Continue with normal fetch if cache fails
      }
    }
    
    logger.info(`Fetching ${c.green(url)}`)
    
    try {
      // Use rate limiter to schedule the fetch
      const res = await this.#rateLimiter.schedule(async () => {
        try {
          // Use custom fetch function if provided, otherwise use the request manager
          if (this.options.fetch) {
            return await this.options.fetch(url, {})
          } else {
            return await this.#requestManager.fetch(
              url, 
              {}, 
              {
                retries: this.options.errors?.retries,
                retryDelay: this.options.errors?.retryDelay
              }
            )
          }
        } catch (error) {
          // Handle error but allow continuing if configured to do so
          return handleError(error, { 
            continueOnError: !!this.options.errors?.continueOnError 
          })
        }
      }, url)
      
      if (!res.ok) {
        logger.warn(`Failed to fetch ${url}: ${res.statusText}`)
        return
      }
      
      if (this.#limitReached()) {
        return
      }
      
      const contentType = res.headers.get('content-type')
      
      if (!contentType?.includes('text/html')) {
        logger.warn(`Not a HTML page: ${url}`)
        return
      }
      
      const resUrl = new URL(res.url)
      
      // redirected to other site, ignore
      if (resUrl.host !== host) {
        logger.warn(`Redirected from ${host} to ${resUrl.host}`)
        return
      }
      
      const htmlContent = await res.text()
      const $ = load(htmlContent)
      
      // Remove script and style elements for cleaner content
      $('script,style,link,img,video').remove()
      
      // Extract all links for further crawling
      const extraUrls: string[] = []
      
      $('a').each((_, el) => {
        const href = $(el).attr('href')
        
        if (!href) {
          return
        }
        
        try {
          const thisUrl = new URL(href, url)
          if (thisUrl.host !== host) {
            return
          }
          
          extraUrls.push(thisUrl.href)
        } catch {
          logger.warn(`Failed to parse URL: ${href}`)
        }
      })
      
      // Detect pagination if enabled
      if (this.options.pagination?.enabled) {
        const paginationUrls = await this.#paginationHandler.detectPagination($, url, htmlContent)
        if (paginationUrls.length > 0) {
          logger.info(`Found ${paginationUrls.length} pagination URLs for ${url}`)
          extraUrls.push(...paginationUrls)
        }
      }
      
      // Add all discovered URLs to the queue
      if (extraUrls.length > 0) {
        for (const url of extraUrls) {
          this.#queue.add(() =>
            this.#fetchPage(url, { ...options, skipMatch: false })
          )
        }
      }
      
      // Extract content from the page
      const window = new Window({
        url,
        settings: {
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          disableCSSFileLoading: true,
        },
      })
      
      const pageTitle = $('title').text()
      const contentSelector = this.#getContentSelector(pathname)
      const html = contentSelector
        ? $(contentSelector).prop('outerHTML')
        : $.html()
      
      if (!html) {
        logger.warn(`No readable content on ${pathname}`)
        return
      }
      
      window.document.write(html)
      
      await window.happyDOM.waitUntilComplete()
      
      const article = new Readability(window.document as any).parse()
      
      await window.happyDOM.close()
      
      if (!article) {
        return
      }
      
      // Store the raw HTML content
      const rawContent = article.content
      
      // Apply content transformation based on options
      let content: string
      
      if (this.options.transform?.format) {
        try {
          const { format, ...transformOptions } = this.options.transform
          
          // Use the appropriate transformer based on the format
          if (format.toLowerCase() === 'html') {
            // Keep HTML as is
            content = rawContent
          } else if (format.toLowerCase() === 'text') {
            // Extract text content
            const tempDiv = window.document.createElement('div')
            tempDiv.innerHTML = rawContent
            content = tempDiv.textContent || ''
          } else {
            // Use markdown transformer by default
            content = toMarkdown(rawContent)
          }
        } catch (error) {
          logger.warn(`Failed to transform content: ${error.message}`)
          // Fall back to markdown
          content = toMarkdown(rawContent)
        }
      } else {
        // Default to markdown
        content = toMarkdown(rawContent)
      }
      
      // Extract pagination metadata if enabled
      let paginationMetadata = undefined
      if (this.options.pagination?.enabled) {
        paginationMetadata = this.#paginationHandler.extractPaginationMetadata($, url)
      }
      
      // Create page object with metadata
      const page: Page = {
        title: article.title || pageTitle,
        url,
        content,
        rawContent,
        fetchedAt: new Date(),
        statusCode: res.status,
        contentType: contentType,
        pagination: paginationMetadata
      }
      
      // Extract metadata if enabled
      if (this.options.metadata) {
        try {
          logger.info(`Extracting metadata for ${url}`)
          // Use the raw HTML (not the cleaned version) for better metadata extraction
          page.metadata = this.#metadataExtractor.extract(htmlContent, url)
          
          // Add date information to page object for filtering
          if (page.metadata?.dates?.published) {
            logger.info(`Found publication date: ${page.metadata.dates.published}`)
          }
        } catch (error) {
          logger.warn(`Failed to extract metadata from ${url}: ${error.message}`)
        }
      }
      
      // Apply content filtering if enabled
      let includePage = true
      if (this.options.filter) {
        includePage = await this.#contentFilter.shouldInclude(page)
        if (!includePage) {
          logger.info(`Filtered out page: ${pathname}`)
        }
      }
      
      if (includePage) {
        // Store the page in our results
        this.#pages.set(pathname, page)
        
        // Store in cache if enabled
        if (this.options.cache?.enabled) {
          try {
            await this.#cache.set(url, page)
          } catch (error) {
            logger.warn(`Failed to cache page ${url}: ${error.message}`)
          }
        }
      }
      
    } catch (error) {
      logger.error(`Error fetching ${url}: ${error.message}`)
    }
  }
  
  /**
   * Gets statistics about the fetcher
   * 
   * @returns Fetcher statistics
   */
  getStats() {
    return {
      pagesCount: this.#pages.size,
      fetchedCount: this.#fetched.size,
      queueSize: this.#queue.size,
      pendingCount: this.#queue.pending,
      rateLimiterStats: this.#rateLimiter.getStats(),
      robotsTxtCacheSize: RobotsParser.getCacheSize(),
      cacheStats: this.options.cache?.enabled ? this.#cache.getStats() : null
    }
  }
  
  /**
   * Updates rate limiting options
   * 
   * @param options New rate limiting options
   */
  updateRateLimitOptions(options: Partial<import('../types').RateLimitOptions>): void {
    this.#rateLimiter.updateOptions(options)
  }
  
  /**
   * Gets the rate limiter instance
   * 
   * @returns The rate limiter
   */
  getRateLimiter(): RateLimiter {
    return this.#rateLimiter
  }
  
  /**
   * Gets the content filter instance
   * 
   * @returns The content filter
   */
  getContentFilter(): ContentFilter {
    return this.#contentFilter
  }
  
  /**
   * Updates content filter options
   * 
   * @param options New filter options
   */
  updateFilterOptions(options: Partial<import('../types').FilterOptions>): void {
    this.#contentFilter.updateOptions(options)
  }
  
  /**
   * Gets the cache instance
   * 
   * @returns The cache instance
   */
  getCache(): Cache {
    return this.#cache
  }
  
  /**
   * Updates cache options
   * 
   * @param options New cache options
   */
  updateCacheOptions(options: Partial<import('../types').CacheOptions>): void {
    this.#cache.updateOptions(options)
  }
  
  /**
   * Gets the metadata extractor instance
   * 
   * @returns The metadata extractor
   */
  getMetadataExtractor(): MetadataExtractor {
    return this.#metadataExtractor
  }
  
  /**
   * Updates metadata extraction options
   * 
   * @param options New metadata options
   */
  updateMetadataOptions(options: Partial<import('../types').MetadataOptions>): void {
    this.#metadataExtractor.updateOptions(options)
  }
  
  /**
   * Gets the request manager instance
   * 
   * @returns The request manager
   */
  getRequestManager(): RequestManager {
    return this.#requestManager
  }
  
  /**
   * Updates request configuration options
   * 
   * @param options New request options
   */
  updateRequestOptions(options: Partial<import('../types').RequestOptions>): void {
    this.#requestManager.updateOptions(options)
  }
  
  /**
   * Applies filtering to already fetched pages
   * 
   * @returns Filtered pages
   */
  async applyFiltering(): Promise<FetchSiteResult> {
    if (!this.options.filter) {
      logger.info('No filtering options provided, skipping filtering')
      return this.#pages
    }
    
    return this.#contentFilter.filterPages(this.#pages)
  }
}

/**
 * Main function to fetch a site
 * 
 * @param url URL to start fetching from
 * @param options Options for fetching
 * @returns Map of pages keyed by pathname
 */
export async function fetchSite(
  url: string,
  options: Options
): Promise<FetchSiteResult> {
  const fetcher = new Fetcher(options)
  const pages = await fetcher.fetchSite(url)
  
  // Apply post-processing filtering if requested
  if (options.filter) {
    logger.info('Applying content filtering to fetched pages')
    return fetcher.applyFiltering()
  }
  
  return pages
}

/**
 * Serializes the fetched pages into a specific format
 * 
 * @param pages Fetched pages
 * @param format Output format
 * @param options Additional transformation options
 * @returns Serialized content
 */
export function serializePages(
  pages: FetchSiteResult,
  format: string = 'text',
  options?: TransformOptions
): string {
  try {
    // Use the transformer system to serialize the pages
    return transformSerializePages(pages, format, options)
  } catch (error) {
    logger.warn(`Failed to serialize pages: ${error.message}`)
    
    // Fallback to basic text format
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
}
