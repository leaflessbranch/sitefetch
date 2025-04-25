/**
 * Test file for the caching system.
 * In a real project, this would be a proper test suite using Jest or similar.
 */

import path from 'node:path'
import fs from 'node:fs'
import { Cache, createCache, CacheError } from './index'
import { Page } from '../types'

// Sample page for testing
const samplePage: Page = {
  title: 'Test Page',
  url: 'https://example.com/test',
  content: 'This is a test page with some content for cache testing.',
  statusCode: 200,
  fetchedAt: new Date(),
}

// Test cache basic functionality
async function testBasicCache() {
  console.log('Testing basic cache functionality...')
  
  // Create cache with test directory
  const testCacheDir = path.resolve('./test-cache')
  const cache = new Cache({
    enabled: true,
    directory: testCacheDir,
    ttl: 60, // 1 minute for testing
    namespace: 'test'
  })
  
  try {
    // Cache validation
    console.log('\nValidating cache...')
    const isValid = await cache.validate()
    console.log(`Cache validation: ${isValid ? 'PASSED' : 'FAILED'}`)
    
    // Set an item in cache
    console.log('\nStoring item in cache...')
    await cache.set(samplePage.url, samplePage)
    
    // Get the item from cache
    console.log('\nRetrieving item from cache...')
    const retrievedPage = await cache.get(samplePage.url)
    
    if (retrievedPage) {
      console.log('PASSED: Item successfully retrieved from cache')
      console.log(`Title: ${retrievedPage.title}`)
      console.log(`URL: ${retrievedPage.url}`)
      console.log(`Content (snippet): ${retrievedPage.content.substring(0, 30)}...`)
    } else {
      console.log('FAILED: Item not found in cache')
    }
    
    // Get cache stats
    console.log('\nCache statistics:')
    console.log(JSON.stringify(cache.getStats(), null, 2))
    
    // Invalidate the item
    console.log('\nInvalidating item...')
    await cache.invalidate(samplePage.url)
    
    // Try to get the invalidated item
    console.log('\nTrying to retrieve invalidated item...')
    const invalidatedPage = await cache.get(samplePage.url)
    
    if (!invalidatedPage) {
      console.log('PASSED: Invalidated item not found in cache')
    } else {
      console.log('FAILED: Invalidated item still in cache')
    }
    
    // Test expired cache
    console.log('\nTesting cache expiration...')
    
    // Create cache with very short TTL
    const shortTtlCache = new Cache({
      enabled: true,
      directory: testCacheDir,
      ttl: 1, // 1 second
      namespace: 'expiration-test'
    })
    
    // Set an item
    await shortTtlCache.set(samplePage.url, samplePage)
    
    // Wait for expiration
    console.log('Waiting for cache to expire...')
    await new Promise(resolve => setTimeout(resolve, 1100))
    
    // Try to get the expired item
    const expiredPage = await shortTtlCache.get(samplePage.url)
    
    if (!expiredPage) {
      console.log('PASSED: Expired item not returned from cache')
    } else {
      console.log('FAILED: Expired item still returned from cache')
    }
    
    // Test custom validation
    console.log('\nTesting custom cache validation...')
    
    const customValidationCache = new Cache({
      enabled: true,
      directory: testCacheDir,
      ttl: 60,
      namespace: 'validation-test',
      // Custom validator that always returns false
      validateCache: (cachedPage, url) => {
        console.log('Custom validator called for', url)
        return false
      }
    })
    
    // Set an item
    await customValidationCache.set(samplePage.url, samplePage)
    
    // Try to get the item (should fail validation)
    const validatedPage = await customValidationCache.get(samplePage.url)
    
    if (!validatedPage) {
      console.log('PASSED: Item failed custom validation and was not returned')
    } else {
      console.log('FAILED: Item passed custom validation when it should have failed')
    }
    
    // Test cache size management
    console.log('\nTesting cache size management...')
    
    const sizeLimitedCache = new Cache({
      enabled: true,
      directory: testCacheDir,
      ttl: 60,
      namespace: 'size-test',
      maxSize: 2000 // Very small size limit
    })
    
    // Create multiple large pages
    const pages = Array.from({ length: 5 }, (_, i) => ({
      ...samplePage,
      url: `https://example.com/test-${i}`,
      content: `Page ${i} content: ` + 'x'.repeat(500) // Make content large enough
    }))
    
    // Add all pages to cache
    for (const page of pages) {
      await sizeLimitedCache.set(page.url, page)
    }
    
    // Get cache stats
    console.log('Cache stats after adding multiple pages:')
    console.log(JSON.stringify(sizeLimitedCache.getStats(), null, 2))
    
    // Try to get the first page (likely pruned due to size limits)
    const firstPage = await sizeLimitedCache.get(pages[0].url)
    
    console.log(`First page (${pages[0].url}) ${firstPage ? 'still in cache' : 'pruned from cache'}`)
    
    // Test clear all cache
    console.log('\nTesting clearing all cache...')
    await cache.clear()
    
    const statsAfterClear = cache.getStats()
    console.log('Cache stats after clearing:')
    console.log(JSON.stringify(statsAfterClear, null, 2))
    
    if (statsAfterClear.items === 0) {
      console.log('PASSED: Cache successfully cleared')
    } else {
      console.log('FAILED: Cache not fully cleared')
    }
    
    // Clean up test directories
    console.log('\nCleaning up test directories...')
    try {
      // Helper function to recursively delete directory
      function deleteFolderRecursive(dirPath: string) {
        if (fs.existsSync(dirPath)) {
          fs.readdirSync(dirPath).forEach((file) => {
            const curPath = path.join(dirPath, file)
            if (fs.lstatSync(curPath).isDirectory()) {
              deleteFolderRecursive(curPath)
            } else {
              fs.unlinkSync(curPath)
            }
          })
          fs.rmdirSync(dirPath)
        }
      }
      
      // Delete test cache directory and all subdirectories
      deleteFolderRecursive(testCacheDir)
      console.log('Test cleanup completed')
    } catch (error) {
      console.error('Error during cleanup:', error.message)
    }
    
  } catch (error) {
    console.error('Test failed with error:', error.message)
    if (error instanceof CacheError) {
      console.error(`Cache error code: ${error.subCode}`)
    }
  }
}

// Test createCache utility function
async function testCacheUtility() {
  console.log('\nTesting createCache utility function...')
  
  const cache = createCache({
    enabled: true,
    directory: './utility-test-cache',
    namespace: 'utility-test'
  })
  
  try {
    // Set and get an item
    await cache.set(samplePage.url, samplePage)
    const retrievedPage = await cache.get(samplePage.url)
    
    if (retrievedPage) {
      console.log('PASSED: Utility cache functions correctly')
    } else {
      console.log('FAILED: Utility cache does not work properly')
    }
    
    // Clean up
    await cache.clear()
    // Remove directory
    fs.rmdirSync('./utility-test-cache/utility-test')
    fs.rmdirSync('./utility-test-cache')
  } catch (error) {
    console.error('Utility test failed:', error.message)
  }
}

// Test disabled cache
async function testDisabledCache() {
  console.log('\nTesting disabled cache...')
  
  const disabledCache = new Cache({
    enabled: false
  })
  
  // Try to set an item (should do nothing)
  await disabledCache.set(samplePage.url, samplePage)
  
  // Try to get the item (should return null)
  const retrievedPage = await disabledCache.get(samplePage.url)
  
  if (!retrievedPage) {
    console.log('PASSED: Disabled cache correctly returns null')
  } else {
    console.log('FAILED: Disabled cache unexpectedly returned a value')
  }
}

// Run all the tests
async function runAllTests() {
  console.log('=== CACHE SYSTEM TESTS ===\n')
  
  await testBasicCache()
  await testCacheUtility()
  await testDisabledCache()
  
  console.log('\n=== ALL TESTS COMPLETED ===')
}

// Uncomment to run the test
// runAllTests().catch(console.error)

/**
 * Example usage in a real application:
 * 
 * ```typescript
 * import { Cache } from './cache'
 * import { fetchSite } from './fetcher'
 * 
 * // Create a cache instance
 * const cache = new Cache({
 *   enabled: true,
 *   directory: './.cache',
 *   ttl: 3600, // 1 hour
 *   namespace: 'my-app'
 * })
 * 
 * async function fetchWithCache(url: string) {
 *   // Try to get from cache first
 *   const cachedPage = await cache.get(url)
 *   
 *   if (cachedPage) {
 *     console.log('Serving from cache:', url)
 *     return cachedPage
 *   }
 *   
 *   // If not in cache, fetch fresh
 *   console.log('Fetching fresh content:', url)
 *   const page = await fetchSite(url, { /* options */ })
 *   
 *   // Store in cache for next time
 *   await cache.set(url, page)
 *   
 *   return page
 * }
 * ```
 */
