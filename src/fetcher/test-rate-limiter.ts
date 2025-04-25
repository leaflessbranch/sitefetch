import { RateLimiter, RateLimitOptions } from './rate-limiter'

// Function to create a simple mock response
function mockResponse(status = 200, headers = {}, body = ''): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(headers),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    // Add other required Response properties as needed
  } as Response
}

// Sample usage of the rate limiter
async function testRateLimiter() {
  console.log('Testing rate limiter...')
  
  // Create a rate limiter with custom options
  const options: RateLimitOptions = {
    requestsPerSecond: 2,
    maxConcurrent: 2,
    minDelay: 500,
    adaptive: true,
    perHostLimits: {
      'example.com': {
        requestsPerSecond: 1,
        minDelay: 1000
      }
    }
  }
  
  const rateLimiter = new RateLimiter(options)
  
  // Set a robots.txt delay for a specific host
  rateLimiter.setRobotsTxtDelay('slow-site.com', 5)
  
  // Test basic rate limiting
  console.log('Testing basic rate limiting...')
  
  const startTime = Date.now()
  
  // Schedule multiple requests to different hosts
  const promises = [
    rateLimiter.schedule(() => {
      console.log(`Request 1 to example.com executed at ${Date.now() - startTime}ms`)
      return Promise.resolve(mockResponse())
    }, 'https://example.com/page1'),
    
    rateLimiter.schedule(() => {
      console.log(`Request 2 to example.com executed at ${Date.now() - startTime}ms`)
      return Promise.resolve(mockResponse())
    }, 'https://example.com/page2'),
    
    rateLimiter.schedule(() => {
      console.log(`Request 3 to example.com executed at ${Date.now() - startTime}ms`)
      return Promise.resolve(mockResponse())
    }, 'https://example.com/page3'),
    
    rateLimiter.schedule(() => {
      console.log(`Request 1 to test.org executed at ${Date.now() - startTime}ms`)
      return Promise.resolve(mockResponse())
    }, 'https://test.org/page1'),
    
    rateLimiter.schedule(() => {
      console.log(`Request 2 to test.org executed at ${Date.now() - startTime}ms`)
      return Promise.resolve(mockResponse())
    }, 'https://test.org/page2'),
    
    rateLimiter.schedule(() => {
      console.log(`Request 1 to slow-site.com executed at ${Date.now() - startTime}ms`)
      return Promise.resolve(mockResponse())
    }, 'https://slow-site.com/page1')
  ]
  
  // Wait for all requests to complete
  await Promise.all(promises)
  
  console.log(`All requests completed in ${Date.now() - startTime}ms`)
  
  // Test rate limit detection
  console.log('\nTesting rate limit detection...')
  
  try {
    await rateLimiter.schedule(() => {
      console.log('Simulating rate limit response...')
      return Promise.resolve(mockResponse(429, { 'retry-after': '2' }))
    }, 'https://example.com/rate-limited')
  } catch (error) {
    console.log('Caught rate limit error as expected')
  }
  
  // Get stats
  console.log('\nRate limiter stats:')
  console.log(JSON.stringify(rateLimiter.getStats(), null, 2))
  
  console.log('\nRate limiter test complete!')
}

// Run the test
testRateLimiter().catch(console.error)
