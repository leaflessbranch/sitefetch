/**
 * Options for caching fetched content
 */
export interface CacheOptions {
  /** Enable caching functionality */
  enabled?: boolean
  /** Directory to store cache files */
  directory?: string
  /** Time to live in seconds (default: 3600) */
  ttl?: number
  /** Compression level (0-9, 0 = no compression, 9 = max compression) */
  compressionLevel?: number
  /** Custom validation function for cached content */
  validateCache?: (cachedPage: Page, url: string) => boolean | Promise<boolean>
  /** Namespace for cache files to prevent collisions */
  namespace?: string
  /** Maximum cache size in bytes (default: unlimited) */
  maxSize?: number
}

export type Options = {
  /**
   * Content filtering options
   */
  filter?: FilterOptions


  /** How many requests can be made at the same time */
  concurrency?: number

  /**
   * Match pathname by specific patterns, powered by micromatch
   * Only pages matched by this will be fetched
   */
  match?: string[]

  /**
   * The CSS selector to find content
   */
  contentSelector?:
    | string
    | ((ctx: { pathname: string }) => string | void | undefined)

  /**
   * Limit the result to this amount of pages
   */
  limit?: number

  /**
   * A custom function to fetch URL
   */
  fetch?: (url: string, init: RequestInit) => Promise<Response>

  /**
   * Error handling options
   */
  errors?: {
    /** Number of retries for failed requests */
    retries?: number
    /** Base delay between retries in ms */
    retryDelay?: number
    /** Continue fetching despite errors */
    continueOnError?: boolean
  }

  /**
   * Request configuration options
   */
  request?: RequestOptions

  /**
   * Rate limiting options to control request frequency
   */
  rateLimit?: RateLimitOptions

  /**
   * Pagination options
   */
  pagination?: PaginationOptions

  /**
   * Content transformation options
   */
  transform?: TransformOptions

  /**
   * Caching options
   */
  cache?: CacheOptions

  /**
   * Metadata extraction options
   */
  metadata?: MetadataOptions
}

/**
 * Options for pagination detection and handling
 */
/**
 * Options for rate limiting and request throttling
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
 * Options for pagination detection and handling
 */
export interface PaginationOptions {
  /** Enable pagination detection and handling */
  enabled?: boolean
  /** Maximum number of pages to follow for each starting URL */
  maxPages?: number
  /** CSS selectors for pagination elements */
  selectors?: {
    /** Selector for "next page" links */
    nextLink?: string
    /** Selector for page number links */
    pageNumbers?: string
  }
  /** Pagination detection strategy */
  strategy?: 'next-link' | 'page-numbers' | 'auto'
  /** Whether to automatically detect pagination elements */
  autoDetect?: boolean
  /** Regular expressions for matching pagination URLs */
  urlPatterns?: {
    /** Patterns that match pagination URLs */
    match?: RegExp[]
    /** Patterns that should not match pagination URLs */
    exclude?: RegExp[]
  }
}

export type Page = {
  title: string
  url: string
  content: string
  /** Raw HTML content before transformation */
  rawContent?: string
  /** HTTP status code of the response */
  statusCode?: number
  /** Content type of the response */
  contentType?: string
  /** When the page was fetched */
  fetchedAt?: Date
  /** Pagination information, if applicable */
  pagination?: {
    /** Current page number, if determined */
    pageNumber?: number
    /** Total number of pages, if determined */
    totalPages?: number
    /** URL to the next page, if available */
    nextPageUrl?: string
    /** URL to the previous page, if available */
    prevPageUrl?: string
  }
  /** Extracted metadata, if metadata extraction is enabled */
  metadata?: {
    /** Publication and modification dates */
    dates?: {
      /** Publication date in ISO format */
      published?: string
      /** Modified date in ISO format */
      modified?: string
      /** All detected dates */
      detected?: string[]
    }
    /** Author information */
    authors?: {
      /** Author names */
      names?: string[]
      /** Author profile URLs */
      links?: string[]
    }
    /** Meta tags from the page */
    meta?: Record<string, string>
    /** OpenGraph metadata */
    openGraph?: Record<string, string>
    /** Twitter card metadata */
    twitterCard?: Record<string, string>
    /** JSON-LD structured data */
    jsonLd?: Array<Record<string, any>>
    /** Microdata extracted from HTML */
    microdata?: Array<Record<string, any>>
    /** Custom extracted metadata */
    custom?: Record<string, any>
  }
}

/**
 * Options for content transformation
 */
export interface TransformOptions {
  /** Output format (markdown, text, html, json, xml, csv) */
  format?: string
  /** Whether to pretty-print the output */
  prettyPrint?: boolean
  /** Whether to remove excess whitespace */
  removeExcessWhitespace?: boolean
  /** Whether to remove consecutive line breaks */
  removeLineBreaks?: boolean
  
  // Markdown-specific options
  /** Heading style for markdown (atx or setext) */
  headingStyle?: 'atx' | 'setext'
  /** Code block style for markdown (fenced or indented) */
  codeBlockStyle?: 'fenced' | 'indented'
  /** Bullet list marker for markdown (*, +, or -) */
  bulletListMarker?: '*' | '+' | '-'
  /** Whether to add spacing between list items */
  listItemSpacing?: boolean
  
  // HTML-specific options
  /** Whether to output as XML */
  xmlMode?: boolean
  /** Whether to remove script tags */
  removeScripts?: boolean
  /** Whether to remove style tags */
  removeStyles?: boolean
  /** Whether to remove HTML comments */
  removeComments?: boolean
  /** Whether to remove inline style attributes */
  removeInlineStyles?: boolean
  /** Whether to remove class attributes */
  removeClasses?: boolean
  /** Whether to remove data attributes */
  removeDataAttributes?: boolean
  /** Whether to remove event handlers (onclick, etc.) */
  removeEventHandlers?: boolean
  /** Whether to remove forms and form elements */
  removeForms?: boolean
  
  // Text-specific options
  /** Whether to format headings in plain text (e.g., "# Heading") */
  plainTextHeadings?: boolean
  /** Whether to include URLs after link text */
  includeLinks?: boolean
}

export type FetchSiteResult = Map<string, Page>

/**
 * Error codes used throughout the application
 */
/**
 * Options for content filtering
 */
export interface FilterOptions {
  /** Text patterns to include (pages must contain at least one) */
  includeText?: string[]
  /** Text patterns to exclude (pages must not contain any) */
  excludeText?: string[]
  /** Date range for content (based on extracted dates) */
  dateRange?: {
    /** Minimum date (inclusive) */
    from?: Date
    /** Maximum date (inclusive) */
    to?: Date
  }
  /** Minimum content length in characters */
  minContentLength?: number
  /** Maximum content length in characters */
  maxContentLength?: number
  /** Custom filter function */
  customFilter?: (page: Page) => boolean | Promise<boolean>
}

/**
 * Filter error specific code
 */
export enum FilterErrorCode {
  FILTER_ERROR = 'FILTER_ERROR'
}

export enum ErrorCode {
  FETCH_ERROR = 'FETCH_ERROR',
  PARSE_ERROR = 'PARSE_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  CACHE_ERROR = 'CACHE_ERROR',
  PAGINATION_ERROR = 'PAGINATION_ERROR',
  TRANSFORM_ERROR = 'TRANSFORM_ERROR',
  METADATA_ERROR = 'METADATA_ERROR',
  PROXY_ERROR = 'PROXY_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Cache-specific error codes
 */
export enum CacheErrorCode {
  READ_ERROR = 'CACHE_READ_ERROR',
  WRITE_ERROR = 'CACHE_WRITE_ERROR',
  VALIDATION_ERROR = 'CACHE_VALIDATION_ERROR',
  EXPIRED = 'CACHE_EXPIRED',
  NOT_FOUND = 'CACHE_NOT_FOUND',
  CORRUPTION = 'CACHE_CORRUPTION'
}

/**
 * Custom HTTP request configuration options
 */
export interface RequestOptions {
  /** Timeout for requests in milliseconds */
  timeout?: number
  /** User agent string to use for requests */
  userAgent?: string
  /** Additional headers to send with requests */
  headers?: Record<string, string>
  /** Cookies to include with requests */
  cookies?: Record<string, string>
  /** Proxy URL to use for requests (e.g., 'http://username:password@proxy.example.com:8080') */
  proxy?: string
  /** Whether to follow redirects (default: true) */
  followRedirects?: boolean
  /** Maximum number of redirects to follow (default: 20) */
  maxRedirects?: number
  /** Maximum response size in bytes (default: unlimited) */
  maxResponseSize?: number
  /** Whether to use HTTP/2 if available (default: false) */
  useHttp2?: boolean
  /** TLS/SSL configuration */
  tls?: {
    /** Whether to verify SSL certificates (default: true) */
    rejectUnauthorized?: boolean
    /** Path to a CA certificate file */
    ca?: string
    /** Path to a client certificate file */
    cert?: string
    /** Path to a client key file */
    key?: string
  }
}

/**
 * Options for metadata extraction
 */
export interface MetadataOptions {
  /** Whether to extract publication dates */
  extractDates?: boolean
  /** Whether to extract author information */
  extractAuthors?: boolean
  /** Whether to extract meta tags */
  extractMetaTags?: boolean
  /** Whether to extract OpenGraph metadata */
  extractOpenGraph?: boolean
  /** Whether to extract Twitter card metadata */
  extractTwitterCard?: boolean
  /** Whether to extract JSON-LD structured data */
  extractJsonLd?: boolean
  /** Whether to extract microdata from HTML attributes */
  extractMicrodata?: boolean
  /** Custom metadata extractors */
  customExtractors?: Array<(
    $: any, 
    url: string
  ) => Record<string, any> | Promise<Record<string, any>>>
}
