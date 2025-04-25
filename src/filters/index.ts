import { Page, FilterOptions, FilterErrorCode } from '../types'
import { logger } from '../logger'
import { SiteFetchError } from '../errors'

/**
 * Error thrown when content filtering fails
 */
export class FilterError extends SiteFetchError {
  constructor(message: string) {
    super(message, FilterErrorCode.FILTER_ERROR)
    this.name = 'FilterError'
  }
}

/**
 * Default filter options
 */
const DEFAULT_FILTER_OPTIONS: FilterOptions = {
  includeText: [],
  excludeText: [],
  minContentLength: 0,
  maxContentLength: Infinity
}

/**
 * Class for filtering page content based on various criteria
 */
export class ContentFilter {
  private options: FilterOptions

  /**
   * Creates a new content filter
   * 
   * @param options Filter options
   */
  constructor(options: FilterOptions = {}) {
    this.options = { ...DEFAULT_FILTER_OPTIONS, ...options }
  }

  /**
   * Checks if a page should be included based on filter criteria
   * 
   * @param page Page to check
   * @returns Whether the page should be included
   */
  async shouldInclude(page: Page): Promise<boolean> {
    try {
      // Apply custom filter if provided
      if (this.options.customFilter) {
        const result = await Promise.resolve(this.options.customFilter(page))
        if (!result) {
          logger.info(`Page ${page.url} excluded by custom filter`)
          return false
        }
      }

      // Check content length
      if (this.options.minContentLength && page.content.length < this.options.minContentLength) {
        logger.info(`Page ${page.url} excluded: content length (${page.content.length}) below minimum (${this.options.minContentLength})`)
        return false
      }

      if (this.options.maxContentLength && page.content.length > this.options.maxContentLength) {
        logger.info(`Page ${page.url} excluded: content length (${page.content.length}) above maximum (${this.options.maxContentLength})`)
        return false
      }

      // Check included text patterns
      if (this.options.includeText && this.options.includeText.length > 0) {
        const matchesInclude = this.options.includeText.some(pattern => 
          this.matchesPattern(page.content, pattern) || 
          this.matchesPattern(page.title, pattern)
        )

        if (!matchesInclude) {
          logger.info(`Page ${page.url} excluded: does not contain any required text patterns`)
          return false
        }
      }

      // Check excluded text patterns
      if (this.options.excludeText && this.options.excludeText.length > 0) {
        const matchesExclude = this.options.excludeText.some(pattern => 
          this.matchesPattern(page.content, pattern) || 
          this.matchesPattern(page.title, pattern)
        )

        if (matchesExclude) {
          logger.info(`Page ${page.url} excluded: contains excluded text pattern`)
          return false
        }
      }

      // Check date range if applicable
      if (this.options.dateRange && (this.options.dateRange.from || this.options.dateRange.to)) {
        const pageDate = this.extractDate(page)
        
        if (pageDate) {
          if (this.options.dateRange.from && pageDate < this.options.dateRange.from) {
            logger.info(`Page ${page.url} excluded: date (${pageDate.toISOString()}) before minimum (${this.options.dateRange.from.toISOString()})`)
            return false
          }

          if (this.options.dateRange.to && pageDate > this.options.dateRange.to) {
            logger.info(`Page ${page.url} excluded: date (${pageDate.toISOString()}) after maximum (${this.options.dateRange.to.toISOString()})`)
            return false
          }
        } else if (this.options.dateRange.from || this.options.dateRange.to) {
          // If date filtering is enabled but no date found, log a warning
          logger.warn(`No date found for page ${page.url}, but date filtering is enabled`)
        }
      }

      // If all checks pass, include the page
      return true
    } catch (error) {
      logger.warn(`Error filtering page ${page.url}: ${error.message}`)
      throw new FilterError(`Failed to filter page ${page.url}: ${error.message}`)
    }
  }

  /**
   * Filters a collection of pages
   * 
   * @param pages Map of pages to filter
   * @returns Filtered map of pages
   */
  async filterPages(pages: Map<string, Page>): Promise<Map<string, Page>> {
    const result = new Map<string, Page>()
    
    for (const [pathname, page] of pages) {
      if (await this.shouldInclude(page)) {
        result.set(pathname, page)
      }
    }
    
    logger.info(`Filtered pages: ${pages.size} original, ${result.size} after filtering`)
    return result
  }

  /**
   * Updates filter options
   * 
   * @param options New filter options
   */
  updateOptions(options: Partial<FilterOptions>): void {
    this.options = { ...this.options, ...options }
  }

  /**
   * Checks if text matches a pattern
   * 
   * @param text Text to check
   * @param pattern Pattern to match (string or regexp)
   * @returns Whether the text matches the pattern
   */
  private matchesPattern(text: string, pattern: string | RegExp): boolean {
    if (pattern instanceof RegExp) {
      return pattern.test(text)
    }
    
    return text.toLowerCase().includes(pattern.toLowerCase())
  }

  /**
   * Extracts date from a page
   * 
   * @param page Page to extract date from
   * @returns Extracted date or undefined
   */
  private extractDate(page: Page): Date | undefined {
    // Try to get date from page metadata
    if (page['publicationDate']) {
      return new Date(page['publicationDate'])
    }
    
    // Try to get date from page metadata
    if (page['metadata'] && page['metadata']['date']) {
      return new Date(page['metadata']['date'])
    }
    
    // Try to get date from OG metadata
    if (page['metadata'] && page['metadata']['og:published_time']) {
      return new Date(page['metadata']['og:published_time'])
    }
    
    // Try to get date from article:published_time
    if (page['metadata'] && page['metadata']['article:published_time']) {
      return new Date(page['metadata']['article:published_time'])
    }
    
    // Try to get date from fetched time as last resort
    if (page.fetchedAt) {
      return new Date(page.fetchedAt)
    }
    
    return undefined
  }
}

/**
 * A simpler function to filter pages
 * 
 * @param pages Map of pages to filter
 * @param options Filter options
 * @returns Filtered map of pages
 */
export async function filterPages(
  pages: Map<string, Page>,
  options: FilterOptions
): Promise<Map<string, Page>> {
  const filter = new ContentFilter(options)
  return filter.filterPages(pages)
}
