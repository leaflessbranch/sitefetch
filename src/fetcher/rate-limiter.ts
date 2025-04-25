import { logger } from '../logger'
import { ErrorCode } from '../types'
import { SiteFetchError } from '../errors'

/**
 * Error thrown when a request is rate limited
 */
export class RateLimitError extends SiteFetchError {
  constructor(public url: string, message?: string) {
    super(
      message || `Rate limited while fetching ${url}`,
      ErrorCode.RATE_LIMIT_ERROR
    )
    this.name = 'RateLimitError'
  }
}

/**
 * Options for rate limiting
 */
export interface RateLimitOptions {
  /** Maximum requests per second (default: 5) */
  requestsPerSecond?: number
  /** Maximum concurrent requests (default: 3) */
  maxConcurrent?: number
  /** Whether to respect robots.txt crawl-delay directive (default: true) */
  respectRobotsTxt?: boolean
  /** Time window in milliseconds for counting requests (default: 1000) */
  timeWindow?: number
  /** Whether to adaptively adjust rate limits based on responses (default: true) */
  adaptive?: boolean
  /** Minimum delay between requests in milliseconds (default: 200) */
  minDelay?: number
  /** Default delay to use for hosts with no explicit rate limit (default: 1000) */
  defaultDelay?: number
  /** Hostnames with custom rate limits */
  perHostLimits?: Record<string, {
    requestsPerSecond?: number,
    minDelay?: number
  }>
  /** Whether to attempt detecting rate limit responses (default: true) */
  detectRateLimits?: boolean
}

/**
 * Default rate limiting options
 */
const DEFAULT_OPTIONS: RateLimitOptions = {
  requestsPerSecond: 5,
  maxConcurrent: 3,
  respectRobotsTxt: true,
  timeWindow: 1000,
  adaptive: true,
  minDelay: 200,
  defaultDelay: 1000,
  detectRateLimits: true
}

/**
 * Patterns for identifying rate limiting in responses
 */
const RATE_LIMIT_PATTERNS = {
  HEADERS: [
    'x-rate-limit-limit',
    'x-rate-limit-remaining',
    'x-rate-limit-reset',
    'retry-after',
    'ratelimit-limit',
    'ratelimit-remaining',
    'ratelimit-reset'
  ],
  STATUS_CODES: [
    429, // Too Many Requests
    418, // I'm a teapot (sometimes used for rate limiting)
    403  // Forbidden (sometimes used for rate limiting)
  ],
  BODY_TEXT: [
    /rate limit(ed|ing)?/i,
    /too many requests/i,
    /request throttled/i,
    /quota exceeded/i,
    /slow down/i
  ]
}

/**
 * State for a specific host
 */
interface HostState {
  requestCount: number
  lastRequestTime: number
  consecutiveErrors: number
  rateLimitDetected: boolean
  robotsTxtDelay?: number
  adaptiveDelay: number
  lastSuccessTime: number
  waitUntil: number
}

/**
 * Implements intelligent rate limiting for HTTP requests
 */
export class RateLimiter {
  private options: RateLimitOptions
  private queue: Array<() => Promise<void>> = []
  private running = 0
  private hostStates: Map<string, HostState> = new Map()
  private globalLastRequestTime = 0
  
  /**
   * Creates a new rate limiter
   * 
   * @param options Rate limiting options
   */
  constructor(options: RateLimitOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }
  
  /**
   * Schedules a function to be executed according to rate limits
   * 
   * @param fn Function to execute
   * @param url URL being requested (used to determine host-specific limits)
   * @returns Promise that resolves with the function result
   */
  async schedule<T>(fn: () => Promise<T>, url: string): Promise<T> {
    const hostname = this.getHostname(url)
    
    // Initialize host state if it doesn't exist
    if (!this.hostStates.has(hostname)) {
      this.initializeHostState(hostname)
    }
    
    // Get the host state
    const hostState = this.hostStates.get(hostname)
    
    // Check if we need to wait until a specific time
    const now = Date.now()
    if (hostState.waitUntil > now) {
      const waitTime = hostState.waitUntil - now
      logger.debug(`Rate limit: waiting ${waitTime}ms for ${hostname}`)
      await this.delay(waitTime)
    }
    
    // Wait for available concurrency slot
    await this.waitForConcurrencySlot()
    
    // Calculate delay based on rate limits
    const delayTime = this.calculateDelay(hostname)
    if (delayTime > 0) {
      await this.delay(delayTime)
    }
    
    // Update counters before executing
    this.running++
    hostState.requestCount++
    hostState.lastRequestTime = Date.now()
    this.globalLastRequestTime = hostState.lastRequestTime
    
    try {
      // Execute the function
      const result = await fn()
      
      // Update host state after successful request
      hostState.consecutiveErrors = 0
      hostState.lastSuccessTime = Date.now()
      
      // Handle response for adaptive rate limiting
      if (this.options.adaptive && result instanceof Response) {
        this.handleResponse(result, hostname)
      }
      
      return result
    } catch (error) {
      // Update host state after failed request
      hostState.consecutiveErrors++
      
      // Implement backoff for consecutive errors
      if (hostState.consecutiveErrors > 1) {
        const backoffTime = Math.min(
          hostState.adaptiveDelay * Math.pow(2, hostState.consecutiveErrors - 1),
          60000 // Cap at 1 minute
        )
        hostState.adaptiveDelay = Math.max(hostState.adaptiveDelay, backoffTime)
        
        // If we've had many consecutive errors, assume rate limiting
        if (hostState.consecutiveErrors >= 3) {
          logger.warn(`Multiple consecutive errors for ${hostname}, assuming rate limiting`)
          hostState.rateLimitDetected = true
          hostState.waitUntil = Date.now() + backoffTime
        }
      }
      
      // Check if the error is due to rate limiting
      if (this.isRateLimitError(error)) {
        hostState.rateLimitDetected = true
        const retryAfter = this.extractRetryAfter(error)
        if (retryAfter) {
          hostState.waitUntil = Date.now() + retryAfter
        } else {
          // Default backoff for rate limit errors
          hostState.waitUntil = Date.now() + Math.max(
            hostState.adaptiveDelay * 2,
            5000 // At least 5 seconds
          )
        }
        
        logger.warn(`Rate limit detected for ${hostname}, waiting until ${new Date(hostState.waitUntil)}`)
      }
      
      throw error
    } finally {
      // Decrement running counter
      this.running--
      
      // Process next item in queue if any
      this.processQueue()
    }
  }
  
  /**
   * Sets the crawl delay from robots.txt for a specific host
   * 
   * @param hostname Host to set crawl delay for
   * @param delaySeconds Delay in seconds
   */
  setRobotsTxtDelay(hostname: string, delaySeconds: number): void {
    if (!this.options.respectRobotsTxt) {
      return
    }
    
    if (!this.hostStates.has(hostname)) {
      this.initializeHostState(hostname)
    }
    
    const hostState = this.hostStates.get(hostname)
    const delayMs = delaySeconds * 1000
    
    logger.info(`Setting robots.txt crawl-delay of ${delaySeconds}s for ${hostname}`)
    hostState.robotsTxtDelay = delayMs
  }
  
  /**
   * Initializes state for a host
   * 
   * @param hostname Host to initialize
   */
  private initializeHostState(hostname: string): void {
    this.hostStates.set(hostname, {
      requestCount: 0,
      lastRequestTime: 0,
      consecutiveErrors: 0,
      rateLimitDetected: false,
      adaptiveDelay: this.getInitialDelayForHost(hostname),
      lastSuccessTime: 0,
      waitUntil: 0
    })
  }
  
  /**
   * Gets the initial delay value for a host
   * 
   * @param hostname Host to get delay for
   * @returns Delay in milliseconds
   */
  private getInitialDelayForHost(hostname: string): number {
    // Check if we have custom limits for this host
    if (this.options.perHostLimits && this.options.perHostLimits[hostname]) {
      const hostLimits = this.options.perHostLimits[hostname]
      
      if (hostLimits.minDelay) {
        return hostLimits.minDelay
      }
      
      if (hostLimits.requestsPerSecond) {
        return Math.max(
          Math.floor(1000 / hostLimits.requestsPerSecond),
          this.options.minDelay
        )
      }
    }
    
    // Use default delay based on global limits
    const requestsPerSecond = this.options.requestsPerSecond || 5
    return Math.max(
      Math.floor(1000 / requestsPerSecond),
      this.options.minDelay
    )
  }
  
  /**
   * Calculates delay needed before next request
   * 
   * @param hostname Host being requested
   * @returns Delay in milliseconds
   */
  private calculateDelay(hostname: string): number {
    const hostState = this.hostStates.get(hostname)
    const now = Date.now()
    const timeSinceLastRequest = now - hostState.lastRequestTime
    const timeSinceLastGlobal = now - this.globalLastRequestTime
    
    let delay = 0
    
    // Apply robots.txt delay if available and respected
    if (this.options.respectRobotsTxt && hostState.robotsTxtDelay) {
      delay = Math.max(delay, hostState.robotsTxtDelay - timeSinceLastRequest)
    }
    
    // Apply rate limiting based on requests per second
    const timeWindow = this.options.timeWindow || 1000
    const requestsPerWindow = this.getRequestsPerWindowForHost(hostname)
    
    if (hostState.requestCount >= requestsPerWindow) {
      delay = Math.max(delay, timeWindow - timeSinceLastRequest)
    }
    
    // Apply adaptive delay if enabled
    if (this.options.adaptive) {
      delay = Math.max(delay, hostState.adaptiveDelay - timeSinceLastRequest)
    }
    
    // Ensure minimum delay between requests
    const minDelay = this.getMinDelayForHost(hostname)
    delay = Math.max(delay, minDelay - timeSinceLastGlobal)
    
    // Apply global minimum delay
    delay = Math.max(delay, this.options.minDelay - timeSinceLastGlobal)
    
    return Math.max(0, delay)
  }
  
  /**
   * Gets the requests per window for a host
   * 
   * @param hostname Host to get limit for
   * @returns Maximum requests per window
   */
  private getRequestsPerWindowForHost(hostname: string): number {
    // Check if we have custom limits for this host
    if (this.options.perHostLimits && this.options.perHostLimits[hostname]) {
      const hostLimits = this.options.perHostLimits[hostname]
      
      if (hostLimits.requestsPerSecond) {
        return hostLimits.requestsPerSecond
      }
    }
    
    return this.options.requestsPerSecond || 5
  }
  
  /**
   * Gets the minimum delay for a host
   * 
   * @param hostname Host to get minimum delay for
   * @returns Minimum delay in milliseconds
   */
  private getMinDelayForHost(hostname: string): number {
    // Check if we have custom limits for this host
    if (this.options.perHostLimits && this.options.perHostLimits[hostname]) {
      const hostLimits = this.options.perHostLimits[hostname]
      
      if (hostLimits.minDelay) {
        return hostLimits.minDelay
      }
    }
    
    return this.options.minDelay || 200
  }
  
  /**
   * Handles response for adaptive rate limiting
   * 
   * @param response Response object
   * @param hostname Host that was requested
   */
  private handleResponse(response: Response, hostname: string): void {
    const hostState = this.hostStates.get(hostname)
    
    // Check for rate limit headers
    let rateLimitDetected = false
    let retryAfter = 0
    
    // Check retry-after header
    const retryAfterHeader = response.headers.get('retry-after')
    if (retryAfterHeader) {
      rateLimitDetected = true
      retryAfter = this.parseRetryAfter(retryAfterHeader)
    }
    
    // Check rate limit headers
    const rateLimitRemaining = parseInt(
      response.headers.get('x-rate-limit-remaining') ||
      response.headers.get('ratelimit-remaining') ||
      '-1',
      10
    )
    
    const rateLimitReset = parseInt(
      response.headers.get('x-rate-limit-reset') ||
      response.headers.get('ratelimit-reset') ||
      '0',
      10
    )
    
    // If we're close to rate limit, slow down
    if (rateLimitRemaining >= 0 && rateLimitRemaining < 5) {
      rateLimitDetected = true
      hostState.adaptiveDelay = Math.max(
        hostState.adaptiveDelay,
        Math.floor(1000 / (rateLimitRemaining + 1))
      )
      
      // If reset time is available, calculate wait time
      if (rateLimitReset > 0) {
        // Some APIs use seconds since epoch, others use seconds until reset
        const resetTime = rateLimitReset > Date.now() / 1000
          ? rateLimitReset * 1000 // Already in future, assume seconds since epoch
          : Date.now() + rateLimitReset * 1000 // Seconds until reset
        
        if (rateLimitRemaining <= 1) {
          hostState.waitUntil = resetTime
        }
      }
    }
    
    // Check status code
    if (RATE_LIMIT_PATTERNS.STATUS_CODES.includes(response.status)) {
      rateLimitDetected = true
      hostState.adaptiveDelay = Math.max(hostState.adaptiveDelay * 2, 5000)
      
      // For 429, wait at least 30 seconds if no retry-after
      if (response.status === 429 && retryAfter === 0) {
        retryAfter = 30000
      }
    }
    
    // Update state based on checks
    if (rateLimitDetected) {
      hostState.rateLimitDetected = true
      logger.warn(`Rate limit detected for ${hostname}`)
      
      // Set wait time if retry-after was found
      if (retryAfter > 0) {
        hostState.waitUntil = Date.now() + retryAfter
        logger.info(`Will wait until ${new Date(hostState.waitUntil)} for ${hostname}`)
      }
    } else if (this.options.adaptive) {
      // Gradually decrease adaptive delay on successful requests
      // but never below the initial delay
      const initialDelay = this.getInitialDelayForHost(hostname)
      if (hostState.adaptiveDelay > initialDelay) {
        hostState.adaptiveDelay = Math.max(
          initialDelay,
          Math.floor(hostState.adaptiveDelay * 0.95) // Gradual 5% reduction
        )
      }
    }
    
    // Reset request count after timeWindow
    setTimeout(() => {
      const state = this.hostStates.get(hostname)
      if (state) {
        state.requestCount = 0
      }
    }, this.options.timeWindow || 1000)
  }
  
  /**
   * Checks if an error is due to rate limiting
   * 
   * @param error Error to check
   * @returns Whether the error is due to rate limiting
   */
  private isRateLimitError(error: any): boolean {
    // Check for our own rate limit error
    if (error instanceof RateLimitError) {
      return true
    }
    
    // Check status code
    if (error.status && RATE_LIMIT_PATTERNS.STATUS_CODES.includes(error.status)) {
      return true
    }
    
    // Check message
    if (error.message) {
      for (const pattern of RATE_LIMIT_PATTERNS.BODY_TEXT) {
        if (pattern.test(error.message)) {
          return true
        }
      }
    }
    
    return false
  }
  
  /**
   * Extracts retry-after duration from error
   * 
   * @param error Error with possible retry information
   * @returns Milliseconds to wait, or 0 if not found
   */
  private extractRetryAfter(error: any): number {
    // Try to get retry-after from headers
    if (error.headers && typeof error.headers.get === 'function') {
      const retryAfter = error.headers.get('retry-after')
      if (retryAfter) {
        return this.parseRetryAfter(retryAfter)
      }
    }
    
    return 0
  }
  
  /**
   * Parses retry-after header value
   * 
   * @param retryAfter Retry-After header value
   * @returns Milliseconds to wait
   */
  private parseRetryAfter(retryAfter: string): number {
    // Retry-After can be a date or seconds
    if (/^\d+$/.test(retryAfter)) {
      // Seconds
      return parseInt(retryAfter, 10) * 1000
    } else {
      try {
        // HTTP date
        const date = new Date(retryAfter)
        return Math.max(0, date.getTime() - Date.now())
      } catch {
        return 30000 // Default 30 seconds if parsing fails
      }
    }
  }
  
  /**
   * Waits for an available concurrency slot
   * 
   * @returns Promise that resolves when a slot is available
   */
  private async waitForConcurrencySlot(): Promise<void> {
    const maxConcurrent = this.options.maxConcurrent || 3
    
    if (this.running >= maxConcurrent) {
      // Create a promise that will resolve when a slot is available
      return new Promise<void>(resolve => {
        this.queue.push(resolve)
      })
    }
  }
  
  /**
   * Processes the next item in the queue
   */
  private processQueue(): void {
    if (this.queue.length > 0 && this.running < (this.options.maxConcurrent || 3)) {
      const next = this.queue.shift()
      if (next) {
        next()
      }
    }
  }
  
  /**
   * Creates a delay promise
   * 
   * @param ms Milliseconds to delay
   * @returns Promise that resolves after the delay
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
  
  /**
   * Extracts hostname from URL
   * 
   * @param url URL to extract hostname from
   * @returns Hostname
   */
  private getHostname(url: string): string {
    try {
      return new URL(url).hostname
    } catch (error) {
      logger.warn(`Invalid URL: ${url}`)
      return 'unknown'
    }
  }
  
  /**
   * Gets statistics about rate limiting
   * 
   * @returns Rate limiting stats
   */
  getStats(): {
    perHost: Record<string, {
      requestCount: number
      lastRequestTime: number
      consecutiveErrors: number
      rateLimitDetected: boolean
      adaptiveDelay: number
      robotsTxtDelay?: number
      waitUntil: number
    }>
    queueLength: number
    runningRequests: number
  } {
    const perHost: Record<string, any> = {}
    
    for (const [hostname, state] of this.hostStates.entries()) {
      perHost[hostname] = { ...state }
    }
    
    return {
      perHost,
      queueLength: this.queue.length,
      runningRequests: this.running
    }
  }
  
  /**
   * Updates options for the rate limiter
   * 
   * @param options New options (partial)
   */
  updateOptions(options: Partial<RateLimitOptions>): void {
    this.options = { ...this.options, ...options }
  }
  
  /**
   * Clears all host states and resets the rate limiter
   */
  reset(): void {
    this.hostStates.clear()
    this.queue = []
    this.running = 0
    this.globalLastRequestTime = 0
  }
}
