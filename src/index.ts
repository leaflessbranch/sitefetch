// Re-export progress tracking classes
export { ProgressTracker, createProgressTracker } from './progress'
// Re-export public API from fetcher module
export { fetchSite, serializePages, Fetcher } from './fetcher'
// Re-export resume handling classes
export { ResumeHandler, createResumeHandler } from './resume'

// Re-export rate limiting classes
export { RateLimiter } from './fetcher/rate-limiter'
export { RobotsParser } from './fetcher/robots-parser'

// Re-export request management classes
export { RequestManager, createRequestManager } from './fetcher/request-manager'

// Re-export content filtering classes
export { ContentFilter, filterPages } from './filters'

// Re-export cache classes
export { Cache, createCache } from './cache'

// Re-export metadata extraction classes
export { MetadataExtractor, createMetadataExtractor } from './metadata'

// Re-export types for public API
export type { 
  Options, 
  Page, 
  FetchSiteResult, 
  RateLimitOptions, 
  FilterOptions, 
  CacheOptions, 
  MetadataOptions, 
  ResumeOptions,
  ErrorOptions, 
  ProgressOptions,
  ProgressStats,
  PageEventData,
  RequestOptions,
  TransformOptions,
  PaginationOptions
} from './types'

// Export error classes for users to handle specific errors
export {
  SiteFetchError,
  FetchError,
  ParseError,
  TimeoutError,
  RateLimitError,
  ValidationError,
  CacheError,
  TransformError,
  ProxyError,
  withRetry
} from './errors'

// Export resume error classes
export { ResumeError } from './resume'

// Export metadata error classes
export { MetadataError } from './metadata'

// Export transform utilities and classes
export { TransformerFactory, getAvailableOutputFormats } from './transforms'

// Export filter error classes
export { FilterError } from './filters'

// Export pagination error classes
export { PaginationError } from './fetcher/pagination'
