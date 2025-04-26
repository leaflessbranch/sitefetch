/**
 * This is a simple test script to demonstrate the progress tracking functionality.
 * In a real project, this would be a proper test suite using Jest or similar.
 */

import { ProgressTracker, ProgressEvent } from './index'

// Test basic progress tracking
async function testProgressTracker() {
  console.log('=== Testing Progress Tracker ===\n')
  
  // Create a progress tracker with default options
  const tracker = new ProgressTracker({
    updateInterval: 500, // Update more frequently for the test
    progressBarWidth: 40,
  })
  
  // Listen for events
  tracker.on(ProgressEvent.START, (data) => {
    console.log(`Start event: Estimated ${data.total} pages to process`)
  })
  
  tracker.on(ProgressEvent.PAGE_FETCHED, (data) => {
    console.log(`Page fetched: ${data.url}${data.timeMs ? ` in ${data.timeMs}ms` : ''}`)
  })
  
  tracker.on(ProgressEvent.PAGE_FAILED, (data) => {
    console.log(`Page failed: ${data.url} - ${data.error.message}`)
  })
  
  tracker.on(ProgressEvent.PAGE_SKIPPED, (data) => {
    console.log(`Page skipped: ${data.url}${data.error ? ` - ${data.error.message}` : ''}`)
  })
  
  tracker.on(ProgressEvent.PROGRESS, (stats) => {
    // Progress events are frequent, so we don't log them all
    // The progress bar will be shown by the tracker itself
  })
  
  tracker.on(ProgressEvent.COMPLETE, (stats) => {
    console.log('\nComplete event:')
    console.log(`- Completed: ${stats.completed}`)
    console.log(`- Failed: ${stats.failed}`)
    console.log(`- Skipped: ${stats.skipped}`)
    console.log(`- Total time: ${(stats.elapsedTimeMs / 1000).toFixed(1)}s`)
    console.log(`- Pages per second: ${stats.pagesPerSecond.toFixed(2)}`)
  })
  
  // Start tracking with 100 estimated pages
  tracker.start(100)
  
  // Simulate fetching pages
  // We'll simulate 100 pages, with 80% success, 10% failure, and 10% skipped
  console.log('\nSimulating page fetches:')
  
  for (let i = 1; i <= 100; i++) {
    // Random delay to simulate variable fetch times
    const delay = 50 + Math.random() * 150
    await new Promise(resolve => setTimeout(resolve, delay))
    
    // Notify that we're fetching a page
    const url = `https://example.com/page${i}`
    tracker.pageFetching(url)
    
    // Simulate success/failure/skip
    const rand = Math.random()
    if (rand < 0.8) {
      // Success (80%)
      await new Promise(resolve => setTimeout(resolve, delay)) // Simulate processing
      tracker.pageFetched(url, {
        title: `Page ${i}`,
        url,
        content: `Content for page ${i}`,
        fetchedAt: new Date()
      }, delay)
    } else if (rand < 0.9) {
      // Failure (10%)
      await new Promise(resolve => setTimeout(resolve, delay / 2)) // Simulate faster failure
      tracker.pageFailed(url, new Error('Failed to fetch'))
    } else {
      // Skip (10%)
      tracker.pageSkipped(url, 'Filtered out by rules')
    }
  }
  
  // Complete the tracking
  tracker.complete()
  
  // Get the final stats
  const stats = tracker.getStats()
  console.log('\nFinal stats:')
  console.log(`- Total processed: ${stats.completed + stats.failed + stats.skipped}/${stats.total}`)
  console.log(`- Success rate: ${(stats.completed / stats.total * 100).toFixed(1)}%`)
  
  // Get recent pages
  const recentPages = tracker.getRecentPages()
  console.log(`\nMost recent pages (${recentPages.length}):`)
  recentPages.slice(-5).forEach((page, index) => {
    console.log(`${index + 1}. ${page.url} - ${page.isSuccess ? 'Success' : 'Failed'}`)
  })
  
  console.log('\n=== Progress Tracker Test Complete ===')
}

// Test tracker with no progress bar (for API usage)
async function testProgressTrackerNoUI() {
  console.log('\n=== Testing Progress Tracker Without UI ===\n')
  
  // Create a tracker with UI disabled
  const tracker = new ProgressTracker({
    showProgressBar: false,
    showStats: true,
  })
  
  // Add event listeners for important events
  tracker.on(ProgressEvent.PROGRESS, (stats) => {
    console.log(`Progress: ${stats.percentComplete.toFixed(1)}% complete`)
  })
  
  // Start with 20 pages
  tracker.start(20)
  
  // Simulate 20 fetches with 200ms delay each
  for (let i = 1; i <= 20; i++) {
    const url = `https://example.com/api/page${i}`
    
    tracker.pageFetching(url)
    await new Promise(resolve => setTimeout(resolve, 200))
    
    if (i % 5 === 0) {
      // Every 5th page fails
      tracker.pageFailed(url, new Error('API error'))
    } else {
      tracker.pageFetched(url, {
        title: `API Page ${i}`,
        url,
        content: `API content ${i}`,
        fetchedAt: new Date()
      }, 200)
    }
  }
  
  tracker.complete()
  
  console.log('\n=== Progress Tracker Without UI Test Complete ===')
}

// Run the tests
(async () => {
  await testProgressTracker()
  await testProgressTrackerNoUI()
})().catch(console.error)

/**
 * Example of how to use the progress tracker in the actual application:
 * 
 * ```typescript
 * import { ProgressTracker } from './progress'
 * import { Fetcher } from './fetcher'
 * 
 * // In Fetcher class:
 * class Fetcher {
 *   private progressTracker: ProgressTracker
 *   
 *   constructor(options) {
 *     this.progressTracker = new ProgressTracker(options.progress)
 *   }
 *   
 *   async fetchSite(url: string) {
 *     // Start progress tracking with an initial estimate
 *     this.progressTracker.start(options.limit || 100)
 *     
 *     // When adding to the queue
 *     this.progressTracker.pageFetching(url)
 *     
 *     // On success
 *     this.progressTracker.pageFetched(url, page, timeMs)
 *     
 *     // On failure
 *     this.progressTracker.pageFailed(url, error)
 *     
 *     // When filtering out pages
 *     this.progressTracker.pageSkipped(url, 'Failed filter criteria')
 *     
 *     // On completion
 *     this.progressTracker.complete()
 *     
 *     return this.#pages
 *   }
 * }
 * ```
 */
