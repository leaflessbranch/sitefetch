import { logger } from '../logger'
import { ErrorCode } from '../types'

/**
 * Base error class for all SiteFetch errors
 */
export class SiteFetchError extends Error {
  constructor(message: string, public code: ErrorCode) {
    super(message)
    this.name = 'SiteFetchError'
  }

  /**
   * Convert the error to a loggable string
   */
  toLogString(): string {
    return `[${this.code}] ${this.message}`
  }
}

/**
 * Error thrown when a fetch operation fails
 */
export class FetchError extends SiteFetchError {
  constructor(
    public url: string,
    public statusCode?: number,
    message?: string
  ) {
    super(
      message || `Failed to fetch ${url}${statusCode ? ` (${statusCode})` : ''}`,
      ErrorCode.FETCH_ERROR
    )
    this.name = 'FetchError'
  }
}

/**
 * Error thrown when parsing HTML content fails
 */
export class ParseError extends SiteFetchError {
  constructor(public url: string, message?: string) {
    super(message || `Failed to parse content from ${url}`, ErrorCode.PARSE_ERROR)
    this.name = 'ParseError'
  }
}

/**
 * Error thrown when a request times out
 */
export class TimeoutError extends SiteFetchError {
  constructor(public url: string, public timeoutMs: number) {
    super(
      `Request to ${url} timed out after ${timeoutMs}ms`,
      ErrorCode.TIMEOUT_ERROR
    )
    this.name = 'TimeoutError'
  }
}

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
 * Error thrown when validation fails
 */
export class ValidationError extends SiteFetchError {
  constructor(message: string) {
    super(message, ErrorCode.VALIDATION_ERROR)
    this.name = 'ValidationError'
  }
}

/**
 * Error thrown when a cache operation fails
 */
export class CacheError extends SiteFetchError {
  constructor(message: string) {
    super(message, ErrorCode.CACHE_ERROR)
    this.name = 'CacheError'
  }
}

/**
 * Error thrown when content transformation fails
 */
export class TransformError extends SiteFetchError {
  constructor(message: string, public format?: string) {
    super(
      format
        ? `Transformation to ${format} failed: ${message}`
        : `Transformation failed: ${message}`,
      ErrorCode.TRANSFORM_ERROR
    )
    this.name = 'TransformError'
  }
}

/**
 * Options for retry functionality
 */
export interface RetryOptions {
  /** Maximum number of retry attempts */
  retries?: number
  /** Base delay in milliseconds */
  retryDelay?: number
  /** Whether to use exponential backoff */
  exponentialBackoff?: boolean
  /** Function to determine if an error is retryable */
  isRetryable?: (error: Error) => boolean
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  retries: 3,
  retryDelay: 1000,
  exponentialBackoff: true,
  isRetryable: (error: Error) => {
    // By default, retry network errors and 5xx errors
    if (error instanceof FetchError) {
      return !error.statusCode || error.statusCode >= 500
    }
    if (error instanceof TimeoutError) {
      return true
    }
    return false
  }
}

/**
 * Retry a function with exponential backoff
 * 
 * @param fn Function to retry
 * @param options Retry options
 * @returns Result of the function
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options }
  const maxRetries = opts.retries || 0
  const baseDelay = opts.retryDelay || 1000
  
  let lastError: Error
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error
      
      const isRetryable = opts.isRetryable?.(lastError) ?? true
      const isLastAttempt = attempt === maxRetries
      
      if (!isRetryable || isLastAttempt) {
        throw lastError
      }
      
      // Calculate delay with jitter
      let delay = baseDelay
      if (opts.exponentialBackoff) {
        // Add randomness to prevent thundering herd
        delay = Math.floor(baseDelay * Math.pow(2, attempt) * (0.5 + Math.random()))
      }
      
      logger.warn(
        `Attempt ${attempt + 1}/${maxRetries + 1} failed. Retrying in ${delay}ms: ${
          lastError.message
        }`
      )
      
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  
  // This should never happen, but TypeScript requires a return
  throw lastError
}

/**
 * Fetch with retry and timeout
 * 
 * @param url URL to fetch
 * @param options Fetch options
 * @param retryOptions Retry options
 * @returns Response object
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeout?: number } = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const { timeout, ...fetchOptions } = options
  
  return withRetry(
    async () => {
      try {
        // If timeout is specified, create an AbortController
        if (timeout) {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), timeout)
          
          try {
            const response = await fetch(url, {
              ...fetchOptions,
              signal: controller.signal
            })
            
            if (!response.ok) {
              throw new FetchError(url, response.status, response.statusText)
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
          const response = await fetch(url, fetchOptions)
          
          if (!response.ok) {
            throw new FetchError(url, response.status, response.statusText)
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
 * Error handler function to decide what to do with errors
 */
export function handleError(error: Error, options: { continueOnError?: boolean } = {}): never {
  if (error instanceof SiteFetchError) {
    logger.warn(error.toLogString())
  } else {
    logger.warn(`[${ErrorCode.UNKNOWN_ERROR}] ${error.message}`)
  }
  
  if (options.continueOnError) {
    // Return a special symbol to indicate continuation
    return undefined as never
  }
  
  throw error
}
