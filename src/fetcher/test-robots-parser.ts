import { RobotsParser } from './robots-parser'
import { RateLimiter } from './rate-limiter'

/**
 * Test the robots.txt parser functionality
 */
async function testRobotsParser() {
  console.log('Testing robots.txt parser...')

  // Create mock response data for testing
  const mockRobotsTxt = `
# robots.txt for example.com
User-agent: *
Disallow: /private/
Crawl-delay: 5

User-agent: Googlebot
Crawl-delay: 2

User-agent: Sitefetch
Crawl-delay: 3
  `

  // Mock fetch for testing
  const originalFetch = global.fetch
  // @ts-ignore
  global.fetch = async (url: string) => {
    console.log(`Mock fetching ${url}`)
    
    if (url.includes('robots.txt')) {
      return {
        ok: true,
        status: 200,
        text: async () => mockRobotsTxt,
      } as Response
    }
    
    throw new Error(`Unexpected URL: ${url}`)
  }

  try {
    // Create a rate limiter to receive the crawl-delay information
    const rateLimiter = new RateLimiter()
    
    // Test parsing with default user agent
    console.log('\nTesting with default user agent:')
    await RobotsParser.parseRobotsForHost('example.com', undefined, rateLimiter)
    
    // Get stats to see if crawl-delay was set
    console.log('\nRate limiter stats:')
    console.log(JSON.stringify(rateLimiter.getStats(), null, 2))
    
    // Reset the rate limiter
    rateLimiter.reset()
    
    // Test parsing with specific user agent
    console.log('\nTesting with Sitefetch user agent:')
    await RobotsParser.parseRobotsForHost('example.com', 'Sitefetch', rateLimiter)
    
    // Get stats again
    console.log('\nRate limiter stats after Sitefetch agent:')
    console.log(JSON.stringify(rateLimiter.getStats(), null, 2))
    
    // Test cache functionality
    console.log('\nTesting cache (should not fetch again):')
    await RobotsParser.parseRobotsForHost('example.com', 'Sitefetch', rateLimiter)
    
    // Clear the cache
    console.log('\nClearing cache...')
    RobotsParser.clearCache()
    console.log(`Cache size: ${RobotsParser.getCacheSize()}`)
    
    console.log('\nRobots parser test complete!')
  } finally {
    // Restore original fetch
    global.fetch = originalFetch
  }
}

// Run the test (uncomment to execute)
// testRobotsParser().catch(console.error)

/**
 * Example of how to use robots parser in real application:
 * 
 * ```typescript
 * import { RobotsParser } from './robots-parser'
 * 
 * // In your fetcher class
 * async function initFetching(url: string) {
 *   const { hostname } = new URL(url)
 *   
 *   // Parse robots.txt before starting the crawl
 *   await RobotsParser.parseRobotsForHost(hostname, 'My User Agent', this.rateLimiter)
 *   
 *   // Now the rate limiter will respect the crawl-delay from robots.txt
 *   // Start crawling...
 * }
 * ```
 */
