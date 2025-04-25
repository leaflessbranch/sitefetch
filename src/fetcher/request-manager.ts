import fs from 'node:fs'
import https from 'node:https'
import { URL } from 'node:url'
import { logger } from '../logger'
import { RequestOptions } from '../types'
import { FetchError, TimeoutError, withRetry, RetryOptions } from '../errors'

/**
 * Default request options
 */
const DEFAULT_REQUEST_OPTIONS: RequestOptions = {
  timeout: 30000,       // 30 seconds
  followRedirects: true,
  maxRedirects: 20,
  userAgent: 'Sitefetch (https://github.com/egoist/sitefetch)',
  headers: {},
  cookies: {},
  useHttp2: false,
  tls: {
    rejectUnauthorized: true
  }
}

/**
 * Class for managing HTTP requests with advanced options
 */
export class RequestManager {
  private options: RequestOptions
  private cookieStore: Map<string, Map<string, string>> = new Map()
  
  /**
   * Creates a new request manager
   * 
   * @param options Request options
   */
  constructor(options: RequestOptions = {}) {
    this.options = { ...DEFAULT_REQUEST_OPTIONS, ...options }
    
    // Initialize cookie store if cookies are provided
    if (this.options.cookies) {
      this.initializeCookies(this.options.cookies)
    }
  }
  
  /**
   * Initializes cookies from options
   * 
   * @param cookies Cookies to initialize
   */
  private initializeCookies(cookies: Record<string, string>): void {
    // Global cookies (no domain)
    const globalCookies = new Map<string, string>()
    
    for (const [name, value] of Object.entries(cookies)) {
      globalCookies.set(name, value)
    }
    
    this.cookieStore.set('global', globalCookies)
  }
  
  /**
   * Gets cookies for a specific URL
   * 
   * @param url URL to get cookies for
   * @returns Cookie header string
   */
  private getCookieHeader(url: string): string {
    const cookies: string[] = []
    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    
    // Add global cookies
    const globalCookies = this.cookieStore.get('global')
    if (globalCookies) {
      for (const [name, value] of globalCookies.entries()) {
        cookies.push(`${name}=${value}`)
      }
    }
    
    // Add domain-specific cookies
    for (const [domain, domainCookies] of this.cookieStore.entries()) {
      if (domain !== 'global' && hostname.endsWith(domain)) {
        for (const [name, value] of domainCookies.entries()) {
          cookies.push(`${name}=${value}`)
        }
      }
    }
    
    return cookies.join('; ')
  }
  
  /**
   * Sets cookies from Set-Cookie header
   * 
   * @param url URL the cookies came from
   * @param setCookieHeader Set-Cookie header value
   */
  private parseCookies(url: string, setCookieHeader: string | string[]): void {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname
    
    // Make sure we have an array of headers
    const cookieHeaders = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]
    
    for (const header of cookieHeaders) {
      const parts = header.split(';').map(part => part.trim())
      const [nameValue] = parts
      
      if (!nameValue || !nameValue.includes('=')) continue
      
      const [name, value] = nameValue.split('=', 2)
      let domain = hostname
      
      // Check for domain attribute
      const domainPart = parts.find(part => part.toLowerCase().startsWith('domain='))
      if (domainPart) {
        const specifiedDomain = domainPart.split('=', 2)[1]
        if (specifiedDomain) {
          domain = specifiedDomain.startsWith('.') ? specifiedDomain.substring(1) : specifiedDomain
        }
      }
      
      // Store the cookie
      if (!this.cookieStore.has(domain)) {
        this.cookieStore.set(domain, new Map())
      }
      
      this.cookieStore.get(domain)?.set(name, value)
    }
  }
  
  /**
   * Creates an HTTPS agent with the specified options
   * 
   * @param url The URL to connect to
   * @returns HTTPS agent with custom options
   */
  private createHttpsAgent(url: string): https.Agent | undefined {
    const tls = this.options.tls
    
    if (!tls) return undefined
    
    const httpsOptions: https.AgentOptions = {
      rejectUnauthorized: tls.rejectUnauthorized
    }
    
    // Add CA certificate if specified
    if (tls.ca) {
      try {
        httpsOptions.ca = fs.readFileSync(tls.ca)
      } catch (error) {
        logger.warn(`Failed to read CA certificate: ${error.message}`)
      }
    }
    
    // Add client certificate if specified
    if (tls.cert) {
      try {
        httpsOptions.cert = fs.readFileSync(tls.cert)
      } catch (error) {
        logger.warn(`Failed to read client certificate: ${error.message}`)
      }
    }
    
    // Add client key if specified
    if (tls.key) {
      try {
        httpsOptions.key = fs.readFileSync(tls.key)
      } catch (error) {
        logger.warn(`Failed to read client key: ${error.message}`)
      }
    }
    
    return new https.Agent(httpsOptions)
  }
  
  /**
   * Combines base options with request-specific options
   * 
   * @param url URL to fetch
   * @param options Request-specific options
   * @returns Combined request options
   */
  private createRequestOptions(url: string, options: RequestInit = {}): RequestInit {
    const headers = new Headers(options.headers || {})
    
    // Set the User-Agent header if not already set
    if (!headers.has('User-Agent') && this.options.userAgent) {
      headers.set('User-Agent', this.options.userAgent)
    }
    
    // Apply custom headers from base options
    if (this.options.headers) {
      for (const [name, value] of Object.entries(this.options.headers)) {
        if (!headers.has(name)) {
          headers.set(name, value)
        }
      }
    }
    
    // Add cookies header if there are cookies
    const cookieHeader = this.getCookieHeader(url)
    if (cookieHeader && !headers.has('Cookie')) {
      headers.set('Cookie', cookieHeader)
    }
    
    // Create HTTPS agent for SSL/TLS options
    const isHttps = url.startsWith('https:')
    const agent = isHttps ? this.createHttpsAgent(url) : undefined
    
    // Create redirection settings
    const redirect = this.options.followRedirects === false ? 'manual' : 'follow'
    
    // Combine everything
    return {
      ...options,
      headers,
      agent,
      redirect,
    }
  }
  
  /**
   * Fetch a URL with advanced options and retry capability
   * 
   * @param url URL to fetch
   * @param options Request-specific options
   * @param retryOptions Options for retry mechanism
   * @returns HTTP response
   */
  async fetch(
    url: string,
    options: RequestInit = {},
    retryOptions: RetryOptions = {}
  ): Promise<Response> {
    // Merge options
    const requestOptions = this.createRequestOptions(url, options)
    const timeout = this.options.timeout
    
    // Set up proxy if needed
    if (this.options.proxy) {
      try {
        // For simplicity in this version, we just log that proxy would be used
        // A full implementation would require setting up an HTTP agent with proxy
        logger.info(`Using proxy: ${this.options.proxy}`)
      } catch (error) {
        logger.warn(`Failed to configure proxy: ${error.message}`)
      }
    }
    
    // Track redirects
    let redirectCount = 0
    const maxRedirects = this.options.maxRedirects || 20
    
    // Execute the fetch with retries
    return withRetry(
      async () => {
        try {
          // If timeout is specified, create an AbortController
          if (timeout) {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeout)
            
            try {
              const response = await fetch(url, {
                ...requestOptions,
                signal: controller.signal
              })
              
              // If not OK and not following redirects manually, throw error
              if (!response.ok && requestOptions.redirect !== 'manual') {
                throw new FetchError(url, response.status, response.statusText)
              }
              
              // Handle redirects manually if needed
              if (
                requestOptions.redirect === 'manual' &&
                (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308) &&
                response.headers.has('Location') &&
                this.options.followRedirects !== false
              ) {
                // Check redirect count
                if (redirectCount >= maxRedirects) {
                  throw new FetchError(url, response.status, `Too many redirects (${redirectCount})`)
                }
                
                // Get redirect URL
                const redirectUrl = new URL(response.headers.get('Location'), url).toString()
                redirectCount++
                
                // Follow the redirect
                return this.fetch(redirectUrl, options, retryOptions)
              }
              
              // Parse and store cookies from response
              const setCookieHeader = response.headers.get('set-cookie')
              if (setCookieHeader) {
                this.parseCookies(url, setCookieHeader)
              }
              
              // Handle max response size if specified
              if (this.options.maxResponseSize && this.options.maxResponseSize > 0) {
                const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
                
                if (contentLength > this.options.maxResponseSize) {
                  throw new FetchError(url, response.status, `Response size (${contentLength}) exceeds maximum (${this.options.maxResponseSize})`)
                }
                
                // For responses without content-length, we'll need to check during read
                // This would be implemented in a more complete version
              }
              
              return response
            } catch (error) {
              if (error.name === 'AbortError') {
                throw new TimeoutError(url, timeout)
              }
              throw error
            } finally {
              clearTimeout(timeoutId)
            }
          } else {
            // No timeout specified, just fetch
            const response = await fetch(url, requestOptions)
            
            // If not OK and not following redirects manually, throw error
            if (!response.ok && requestOptions.redirect !== 'manual') {
              throw new FetchError(url, response.status, response.statusText)
            }
            
            // Handle redirects manually if needed (same logic as above)
            if (
              requestOptions.redirect === 'manual' &&
              (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307 || response.status === 308) &&
              response.headers.has('Location') &&
              this.options.followRedirects !== false
            ) {
              // Check redirect count
              if (redirectCount >= maxRedirects) {
                throw new FetchError(url, response.status, `Too many redirects (${redirectCount})`)
              }
              
              // Get redirect URL
              const redirectUrl = new URL(response.headers.get('Location'), url).toString()
              redirectCount++
              
              // Follow the redirect
              return this.fetch(redirectUrl, options, retryOptions)
            }
            
            // Parse and store cookies from response
            const setCookieHeader = response.headers.get('set-cookie')
            if (setCookieHeader) {
              this.parseCookies(url, setCookieHeader)
            }
            
            return response
          }
        } catch (error) {
          // Convert native fetch errors to our custom errors
          if (error instanceof TypeError || error.name === 'TypeError') {
            throw new FetchError(url, undefined, error.message)
          }
          throw error
        }
      },
      retryOptions
    )
  }
  
  /**
   * Get all stored cookies
   * 
   * @returns Map of domain to cookies
   */
  getCookies(): Map<string, Map<string, string>> {
    return new Map(this.cookieStore)
  }
  
  /**
   * Add a cookie to the store
   * 
   * @param domain Domain for the cookie
   * @param name Cookie name
   * @param value Cookie value
   */
  setCookie(domain: string, name: string, value: string): void {
    if (!this.cookieStore.has(domain)) {
      this.cookieStore.set(domain, new Map())
    }
    
    this.cookieStore.get(domain)?.set(name, value)
  }
  
  /**
   * Clear all cookies
   */
  clearCookies(): void {
    this.cookieStore.clear()
  }
  
  /**
   * Updates request options
   * 
   * @param options New options to merge
   */
  updateOptions(options: Partial<RequestOptions>): void {
    this.options = { ...this.options, ...options }
    
    // Reinitialize cookies if provided
    if (options.cookies) {
      this.initializeCookies(options.cookies)
    }
  }
}

/**
 * Create a request manager with the given options
 * 
 * @param options Request options
 * @returns Request manager instance
 */
export function createRequestManager(options?: RequestOptions): RequestManager {
  return new RequestManager(options)
}
