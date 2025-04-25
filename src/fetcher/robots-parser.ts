import { logger } from '../logger'
import { RateLimiter } from './rate-limiter'
import { fetchWithRetry } from '../errors'

/**
 * Cache for robots.txt content to avoid re-fetching
 */
const robotsCache = new Map<string, {
  content: string;
  fetchedAt: number;
  crawlDelay?: number;
}>()

/**
 * Cache TTL in milliseconds (1 hour)
 */
const ROBOTS_CACHE_TTL = 60 * 60 * 1000

/**
 * Handles parsing robots.txt files for rate limiting information
 */
export class RobotsParser {
  /**
   * Parses a robots.txt file and extracts crawl-delay directive
   * 
   * @param hostname Host to fetch robots.txt for
   * @param userAgent User agent to check for in robots.txt
   * @param rateLimiter Rate limiter to update with crawl-delay
   * @returns Promise resolving to whether robots.txt was successfully processed
   */
  static async parseRobotsForHost(
    hostname: string,
    userAgent = 'Sitefetch',
    rateLimiter?: RateLimiter
  ): Promise<boolean> {
    try {
      // Check cache first
      const now = Date.now()
      const cached = robotsCache.get(hostname)
      
      if (cached && now - cached.fetchedAt < ROBOTS_CACHE_TTL) {
        logger.info(`Using cached robots.txt for ${hostname}`)
        
        if (cached.crawlDelay && rateLimiter) {
          rateLimiter.setRobotsTxtDelay(hostname, cached.crawlDelay)
        }
        
        return true
      }
      
      // Fetch robots.txt
      logger.info(`Fetching robots.txt for ${hostname}`)
      
      const robotsUrl = `https://${hostname}/robots.txt`
      
      const response = await fetchWithRetry(robotsUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': userAgent
        }
      }, {
        retries: 2,
        retryDelay: 1000
      })
      
      if (!response.ok) {
        logger.warn(`Failed to fetch robots.txt for ${hostname}: ${response.statusText}`)
        return false
      }
      
      const content = await response.text()
      
      // Store in cache
      const cacheEntry = {
        content,
        fetchedAt: now,
        crawlDelay: undefined
      }
      
      // Parse for crawl-delay
      const crawlDelay = this.extractCrawlDelay(content, userAgent)
      
      if (crawlDelay !== undefined) {
        cacheEntry.crawlDelay = crawlDelay
        
        if (rateLimiter) {
          rateLimiter.setRobotsTxtDelay(hostname, crawlDelay)
        }
        
        logger.info(`Found crawl-delay of ${crawlDelay}s for ${hostname}`)
      }
      
      robotsCache.set(hostname, cacheEntry)
      
      return true
    } catch (error) {
      logger.warn(`Error parsing robots.txt for ${hostname}: ${error.message}`)
      return false
    }
  }
  
  /**
   * Extracts crawl-delay directive from robots.txt content
   * 
   * @param content Robots.txt content
   * @param userAgent User agent to check for
   * @returns Crawl delay in seconds, or undefined if not found
   */
  private static extractCrawlDelay(content: string, userAgent: string): number | undefined {
    // Split into lines and normalize
    const lines = content
      .split('\n')
      .map(line => line.trim().toLowerCase())
      .filter(line => line && !line.startsWith('#'))
    
    let matchedUserAgent = false
    
    for (const line of lines) {
      // Check for user-agent section
      if (line.startsWith('user-agent:')) {
        const agent = line.substring('user-agent:'.length).trim()
        
        // Reset matched flag for new user-agent section
        matchedUserAgent = false
        
        // Check if this section applies to our user agent
        if (
          agent === '*' || 
          userAgent.toLowerCase().includes(agent) || 
          agent.includes(userAgent.toLowerCase())
        ) {
          matchedUserAgent = true
        }
      } 
      // Check for crawl-delay if in a matching user-agent section
      else if (matchedUserAgent && line.startsWith('crawl-delay:')) {
        const delayStr = line.substring('crawl-delay:'.length).trim()
        const delay = parseFloat(delayStr)
        
        if (!isNaN(delay) && delay > 0) {
          return delay
        }
      }
    }
    
    return undefined
  }
  
  /**
   * Clears the robots.txt cache
   */
  static clearCache(): void {
    robotsCache.clear()
  }
  
  /**
   * Gets the number of entries in the robots.txt cache
   * 
   * @returns Number of cached entries
   */
  static getCacheSize(): number {
    return robotsCache.size
  }
}
