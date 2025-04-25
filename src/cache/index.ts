import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { logger } from '../logger'
import { SiteFetchError } from '../errors'
import { Page, CacheOptions, ErrorCode, CacheErrorCode } from '../types'

// Promisify zlib functions
const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/**
 * Default cache directory
 */
const DEFAULT_CACHE_DIR = '.sitefetch-cache'

/**
 * Default cache options
 */
const DEFAULT_CACHE_OPTIONS: CacheOptions = {
  enabled: true,
  directory: DEFAULT_CACHE_DIR,
  ttl: 3600, // 1 hour in seconds
  compressionLevel: 6,
  namespace: 'default'
}

/**
 * Cache metadata format
 */
interface CacheMetadata {
  url: string
  timestamp: number // When the page was cached
  expires: number // When the cache expires
  hash: string // Content hash for validation
  size: number // Content size in bytes
  compressed: boolean // Whether the content is compressed
}

/**
 * Cache entry format (stored on disk)
 */
interface CacheEntry {
  metadata: CacheMetadata
  page: Page
}

/**
 * Cache statistics
 */
interface CacheStats {
  hits: number
  misses: number
  writes: number
  errors: number
  size: number
  items: number
}

/**
 * Error thrown when cache operations fail
 */
export class CacheError extends SiteFetchError {
  constructor(message: string, public subCode: CacheErrorCode) {
    super(message, ErrorCode.CACHE_ERROR)
    this.name = 'CacheError'
  }
}

/**
 * Cache manager for fetched pages
 */
export class Cache {
  private options: CacheOptions
  private cacheDir: string
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    writes: 0,
    errors: 0,
    size: 0,
    items: 0
  }
  
  /**
   * Creates a new cache instance
   * 
   * @param options Cache configuration options
   */
  constructor(options?: CacheOptions) {
    this.options = { ...DEFAULT_CACHE_OPTIONS, ...options }
    
    // If caching is disabled, don't initialize
    if (!this.options.enabled) {
      logger.info('Cache is disabled')
      this.cacheDir = ''
      return
    }
    
    // Set up cache directory
    const cacheDir = this.options.directory || DEFAULT_CACHE_DIR
    
    // If a namespace is provided, use it to create a subdirectory
    this.cacheDir = this.options.namespace 
      ? path.join(cacheDir, this.options.namespace)
      : cacheDir
    
    // Create cache directory if it doesn't exist
    this.ensureCacheDirectory()
    
    // Initialize cache stats
    this.refreshStats()
    
    logger.info(`Cache initialized at ${this.cacheDir}`)
  }
  
  /**
   * Ensures the cache directory exists
   * 
   * @private
   */
  private ensureCacheDirectory(): void {
    if (!this.options.enabled) return
    
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true })
    } catch (error) {
      logger.warn(`Failed to create cache directory ${this.cacheDir}: ${error.message}`)
      throw new CacheError(
        `Failed to create cache directory: ${error.message}`,
        CacheErrorCode.WRITE_ERROR
      )
    }
  }
  
  /**
   * Generates a cache key for a URL
   * 
   * @param url URL to generate key for
   * @returns Cache key
   * @private
   */
  private generateCacheKey(url: string): string {
    // Create a hash of the URL to use as the filename
    const hash = createHash('md5').update(url).digest('hex')
    return hash
  }
  
  /**
   * Gets the full path for a cache file
   * 
   * @param key Cache key
   * @returns Full path to cache file
   * @private
   */
  private getCacheFilePath(key: string): string {
    return path.join(this.cacheDir, `${key}.json.gz`)
  }
  
  /**
   * Calculates a hash of page content for validation
   * 
   * @param page Page to hash
   * @returns Content hash
   * @private
   */
  private calculateContentHash(page: Page): string {
    const hashContent = JSON.stringify({
      title: page.title,
      content: page.content,
      statusCode: page.statusCode
    })
    return createHash('sha256').update(hashContent).digest('hex')
  }
  
  /**
   * Compresses data using gzip
   * 
   * @param data Data to compress
   * @returns Compressed data
   * @private
   */
  private async compress(data: string): Promise<Buffer> {
    try {
      return await gzipAsync(Buffer.from(data), {
        level: this.options.compressionLevel || 6
      })
    } catch (error) {
      logger.warn(`Failed to compress cache data: ${error.message}`)
      throw new CacheError(
        `Failed to compress cache data: ${error.message}`,
        CacheErrorCode.WRITE_ERROR
      )
    }
  }
  
  /**
   * Decompresses gzipped data
   * 
   * @param data Compressed data
   * @returns Decompressed data
   * @private
   */
  private async decompress(data: Buffer): Promise<string> {
    try {
      const decompressed = await gunzipAsync(data)
      return decompressed.toString('utf-8')
    } catch (error) {
      logger.warn(`Failed to decompress cache data: ${error.message}`)
      throw new CacheError(
        `Failed to decompress cache data: ${error.message}`,
        CacheErrorCode.READ_ERROR
      )
    }
  }
  
  /**
   * Checks if a cached page is still valid
   * 
   * @param cachedEntry Cache entry to validate
   * @param url Original URL
   * @returns Whether the cache is valid
   * @private
   */
  private async isCacheValid(cachedEntry: CacheEntry, url: string): Promise<boolean> {
    // Check if cache has expired
    const now = Date.now()
    if (cachedEntry.metadata.expires < now) {
      logger.info(`Cache expired for ${url}`)
      return false
    }
    
    // If a custom validation function is provided, use it
    if (this.options.validateCache) {
      try {
        const isValid = await Promise.resolve(
          this.options.validateCache(cachedEntry.page, url)
        )
        return isValid
      } catch (error) {
        logger.warn(`Cache validation failed for ${url}: ${error.message}`)
        return false
      }
    }
    
    // Default validation: just check expiration time
    return true
  }
  
  /**
   * Retrieves a page from cache
   * 
   * @param url URL to retrieve
   * @returns Cached page or null if not found or invalid
   */
  async get(url: string): Promise<Page | null> {
    // If caching is disabled, always return null
    if (!this.options.enabled) {
      return null
    }
    
    const cacheKey = this.generateCacheKey(url)
    const cacheFilePath = this.getCacheFilePath(cacheKey)
    
    try {
      // Check if cache file exists
      if (!fs.existsSync(cacheFilePath)) {
        this.stats.misses++
        return null
      }
      
      // Read the cache file
      const fileContent = fs.readFileSync(cacheFilePath)
      
      // Decompress if needed
      let cacheContent: string
      try {
        cacheContent = await this.decompress(fileContent)
      } catch (error) {
        // If decompression fails, delete the corrupt cache file
        try {
          fs.unlinkSync(cacheFilePath)
        } catch (unlinkError) {
          // Ignore errors when trying to delete corrupt cache
        }
        this.stats.errors++
        throw new CacheError(
          `Cache file corruption for ${url}: ${error.message}`,
          CacheErrorCode.CORRUPTION
        )
      }
      
      // Parse the cache entry
      let cacheEntry: CacheEntry
      try {
        cacheEntry = JSON.parse(cacheContent)
      } catch (error) {
        // If parsing fails, delete the corrupt cache file
        try {
          fs.unlinkSync(cacheFilePath)
        } catch (unlinkError) {
          // Ignore errors when trying to delete corrupt cache
        }
        this.stats.errors++
        throw new CacheError(
          `Invalid cache format for ${url}: ${error.message}`,
          CacheErrorCode.CORRUPTION
        )
      }
      
      // Validate the cache
      const isValid = await this.isCacheValid(cacheEntry, url)
      if (!isValid) {
        // Delete invalid cache
        try {
          fs.unlinkSync(cacheFilePath)
        } catch (unlinkError) {
          // Ignore errors when trying to delete invalid cache
        }
        this.stats.misses++
        return null
      }
      
      logger.info(`Cache hit for ${url}`)
      this.stats.hits++
      
      // Return the cached page
      return cacheEntry.page
    } catch (error) {
      if (error instanceof CacheError) {
        throw error
      }
      
      this.stats.errors++
      logger.warn(`Cache read error for ${url}: ${error.message}`)
      return null
    }
  }
  
  /**
   * Stores a page in the cache
   * 
   * @param url URL of the page
   * @param page Page to cache
   */
  async set(url: string, page: Page): Promise<void> {
    // If caching is disabled, do nothing
    if (!this.options.enabled) {
      return
    }
    
    const cacheKey = this.generateCacheKey(url)
    const cacheFilePath = this.getCacheFilePath(cacheKey)
    
    try {
      // Ensure the cache directory exists
      this.ensureCacheDirectory()
      
      // Check cache size limits if configured
      if (this.options.maxSize && this.stats.size >= this.options.maxSize) {
        await this.pruneCache()
      }
      
      // Create cache metadata
      const now = Date.now()
      const ttl = (this.options.ttl || 3600) * 1000
      
      const metadata: CacheMetadata = {
        url,
        timestamp: now,
        expires: now + ttl,
        hash: this.calculateContentHash(page),
        size: JSON.stringify(page).length,
        compressed: true
      }
      
      // Create the cache entry
      const cacheEntry: CacheEntry = {
        metadata,
        page
      }
      
      // Serialize and compress the cache entry
      const serialized = JSON.stringify(cacheEntry)
      const compressed = await this.compress(serialized)
      
      // Write to file
      fs.writeFileSync(cacheFilePath, compressed)
      
      logger.info(`Cached page ${url}`)
      this.stats.writes++
      
      // Update stats
      this.refreshStats()
    } catch (error) {
      if (error instanceof CacheError) {
        throw error
      }
      
      this.stats.errors++
      logger.warn(`Cache write error for ${url}: ${error.message}`)
      
      throw new CacheError(
        `Failed to write cache for ${url}: ${error.message}`,
        CacheErrorCode.WRITE_ERROR
      )
    }
  }
  
  /**
   * Removes a URL from the cache
   * 
   * @param url URL to remove
   */
  async invalidate(url: string): Promise<void> {
    // If caching is disabled, do nothing
    if (!this.options.enabled) {
      return
    }
    
    const cacheKey = this.generateCacheKey(url)
    const cacheFilePath = this.getCacheFilePath(cacheKey)
    
    try {
      // Check if cache file exists
      if (fs.existsSync(cacheFilePath)) {
        // Delete the file
        fs.unlinkSync(cacheFilePath)
        logger.info(`Invalidated cache for ${url}`)
        
        // Update stats
        this.refreshStats()
      }
    } catch (error) {
      logger.warn(`Failed to invalidate cache for ${url}: ${error.message}`)
      
      throw new CacheError(
        `Failed to invalidate cache for ${url}: ${error.message}`,
        CacheErrorCode.WRITE_ERROR
      )
    }
  }
  
  /**
   * Removes all items from the cache
   */
  async clear(): Promise<void> {
    // If caching is disabled, do nothing
    if (!this.options.enabled) {
      return
    }
    
    try {
      // Check if cache directory exists
      if (fs.existsSync(this.cacheDir)) {
        // Get all cache files
        const files = fs.readdirSync(this.cacheDir)
        
        // Delete each file
        for (const file of files) {
          const filePath = path.join(this.cacheDir, file)
          fs.unlinkSync(filePath)
        }
        
        logger.info(`Cleared cache directory ${this.cacheDir}`)
        
        // Reset stats
        this.stats = {
          hits: 0,
          misses: 0,
          writes: 0,
          errors: 0,
          size: 0,
          items: 0
        }
      }
    } catch (error) {
      logger.warn(`Failed to clear cache: ${error.message}`)
      
      throw new CacheError(
        `Failed to clear cache: ${error.message}`,
        CacheErrorCode.WRITE_ERROR
      )
    }
  }
  
  /**
   * Prunes the cache to free up space based on expiration and size limits
   * 
   * @private
   */
  private async pruneCache(): Promise<void> {
    if (!this.options.enabled || !fs.existsSync(this.cacheDir)) {
      return
    }
    
    try {
      // Get all cache files
      const files = fs.readdirSync(this.cacheDir)
      
      // Get file details for sorting
      const fileDetails: Array<{
        path: string
        stat: fs.Stats
        expires?: number
      }> = []
      
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file)
        const stat = fs.statSync(filePath)
        
        // Try to read expiration from file
        let expires: number | undefined
        
        try {
          const fileContent = fs.readFileSync(filePath)
          const content = await this.decompress(fileContent)
          const entry: CacheEntry = JSON.parse(content)
          expires = entry.metadata.expires
        } catch (error) {
          // If we can't read expiration, use file stats
          expires = undefined
        }
        
        fileDetails.push({
          path: filePath,
          stat,
          expires
        })
      }
      
      // First remove expired files
      const now = Date.now()
      let removedCount = 0
      
      for (const file of fileDetails) {
        if (file.expires && file.expires < now) {
          fs.unlinkSync(file.path)
          removedCount++
        }
      }
      
      // If we still need to free up space, remove oldest files
      if (this.options.maxSize && this.stats.size > this.options.maxSize) {
        const remaining = fileDetails
          .filter(file => fs.existsSync(file.path))
          .sort((a, b) => a.stat.mtime.getTime() - b.stat.mtime.getTime())
        
        let currentSize = this.stats.size
        let targetSize = this.options.maxSize * 0.8 // Aim to get down to 80%
        
        for (const file of remaining) {
          if (currentSize <= targetSize) break
          
          try {
            const size = file.stat.size
            fs.unlinkSync(file.path)
            currentSize -= size
            removedCount++
          } catch (error) {
            // Ignore errors and continue
          }
        }
      }
      
      logger.info(`Pruned ${removedCount} items from cache`)
      
      // Update stats
      this.refreshStats()
    } catch (error) {
      logger.warn(`Failed to prune cache: ${error.message}`)
      
      throw new CacheError(
        `Failed to prune cache: ${error.message}`,
        CacheErrorCode.WRITE_ERROR
      )
    }
  }
  
  /**
   * Updates the cache statistics
   * 
   * @private
   */
  private refreshStats(): void {
    if (!this.options.enabled || !fs.existsSync(this.cacheDir)) {
      this.stats.size = 0
      this.stats.items = 0
      return
    }
    
    try {
      const files = fs.readdirSync(this.cacheDir)
      let totalSize = 0
      
      // Calculate total size
      for (const file of files) {
        const filePath = path.join(this.cacheDir, file)
        const stat = fs.statSync(filePath)
        totalSize += stat.size
      }
      
      this.stats.size = totalSize
      this.stats.items = files.length
    } catch (error) {
      logger.warn(`Failed to refresh cache stats: ${error.message}`)
    }
  }
  
  /**
   * Gets the cache statistics
   * 
   * @returns Cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }
  
  /**
   * Updates the cache options
   * 
   * @param options New cache options
   */
  updateOptions(options: Partial<CacheOptions>): void {
    this.options = { ...this.options, ...options }
    
    // If directory changed, update cacheDir and ensure it exists
    if (options.directory || options.namespace) {
      const cacheDir = this.options.directory || DEFAULT_CACHE_DIR
      this.cacheDir = this.options.namespace 
        ? path.join(cacheDir, this.options.namespace)
        : cacheDir
      
      this.ensureCacheDirectory()
    }
    
    // Refresh stats in case options change affects them
    this.refreshStats()
  }
  
  /**
   * Validates the cache setup
   * 
   * @returns Promise resolving to true if cache is operational
   */
  async validate(): Promise<boolean> {
    if (!this.options.enabled) {
      return false
    }
    
    try {
      // Ensure directory exists
      this.ensureCacheDirectory()
      
      // Try to write and read a test file
      const testKey = 'test-' + Date.now()
      const testPath = path.join(this.cacheDir, `${testKey}.test`)
      
      // Write test data
      fs.writeFileSync(testPath, 'cache-test')
      
      // Read test data
      const data = fs.readFileSync(testPath, 'utf-8')
      
      // Clean up
      fs.unlinkSync(testPath)
      
      return data === 'cache-test'
    } catch (error) {
      logger.warn(`Cache validation failed: ${error.message}`)
      return false
    }
  }
}

// Export a simpler function for direct use
/**
 * Creates a cache instance with the given options
 * 
 * @param options Cache options
 * @returns Cache instance
 */
export function createCache(options?: CacheOptions): Cache {
  return new Cache(options)
}
