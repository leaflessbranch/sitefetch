/**
 * This is a simple test script to demonstrate the content filtering functionality.
 * In a real project, this would be a proper test suite using Jest or similar.
 */

import { ContentFilter, filterPages } from './index'
import { Page } from '../types'

// Create some sample pages
const samplePages = new Map<string, Page>()

samplePages.set('/page1', {
  title: 'Test Page 1',
  url: 'https://example.com/page1',
  content: 'This is a short test page with some content.',
  fetchedAt: new Date('2023-01-15T12:00:00Z')
})

samplePages.set('/page2', {
  title: 'Test Page 2',
  url: 'https://example.com/page2',
  content: 'This is a longer test page with more content about JavaScript and TypeScript programming.',
  fetchedAt: new Date('2023-02-20T15:30:00Z'),
  metadata: {
    'date': '2023-02-15T10:00:00Z'
  }
})

samplePages.set('/page3', {
  title: 'Test Page 3',
  url: 'https://example.com/page3',
  content: 'This page contains information about Python programming and data science.',
  fetchedAt: new Date('2023-03-25T08:45:00Z')
})

samplePages.set('/page4', {
  title: 'Test Page 4',
  url: 'https://example.com/page4',
  content: 'A very detailed and comprehensive guide to web development using various frameworks and libraries. ' +
    'This includes React, Vue, Angular, and many other popular tools and technologies. ' +
    'The content is quite extensive and covers many topics in depth.',
  fetchedAt: new Date('2023-04-10T14:20:00Z'),
  metadata: {
    'article:published_time': '2023-04-05T09:00:00Z'
  }
})

// Test different filtering scenarios
async function testContentFiltering() {
  console.log('Testing content filtering...\n')
  
  // Test 1: Filter by minimum content length
  console.log('Test 1: Filter by minimum content length (> 50 characters)')
  const lengthFilter = new ContentFilter({
    minContentLength: 50
  })
  
  const lengthFilteredPages = await lengthFilter.filterPages(samplePages)
  console.log(`Result: ${samplePages.size} pages before, ${lengthFilteredPages.size} pages after filtering`)
  console.log('Remaining pages:', Array.from(lengthFilteredPages.keys()).join(', '))
  console.log()
  
  // Test 2: Filter by included text
  console.log('Test 2: Filter by included text (must contain "JavaScript")')
  const includeFilter = new ContentFilter({
    includeText: ['JavaScript']
  })
  
  const includeFilteredPages = await includeFilter.filterPages(samplePages)
  console.log(`Result: ${samplePages.size} pages before, ${includeFilteredPages.size} pages after filtering`)
  console.log('Remaining pages:', Array.from(includeFilteredPages.keys()).join(', '))
  console.log()
  
  // Test 3: Filter by excluded text
  console.log('Test 3: Filter by excluded text (must not contain "Python")')
  const excludeFilter = new ContentFilter({
    excludeText: ['Python']
  })
  
  const excludeFilteredPages = await excludeFilter.filterPages(samplePages)
  console.log(`Result: ${samplePages.size} pages before, ${excludeFilteredPages.size} pages after filtering`)
  console.log('Remaining pages:', Array.from(excludeFilteredPages.keys()).join(', '))
  console.log()
  
  // Test 4: Filter by date range
  console.log('Test 4: Filter by date range (Feb 2023 - Mar 2023)')
  const dateFilter = new ContentFilter({
    dateRange: {
      from: new Date('2023-02-01'),
      to: new Date('2023-03-31')
    }
  })
  
  const dateFilteredPages = await dateFilter.filterPages(samplePages)
  console.log(`Result: ${samplePages.size} pages before, ${dateFilteredPages.size} pages after filtering`)
  console.log('Remaining pages:', Array.from(dateFilteredPages.keys()).join(', '))
  console.log()
  
  // Test 5: Combined filters
  console.log('Test 5: Combined filters (min length 50, exclude "Python", between Jan-Mar 2023)')
  const combinedFilter = new ContentFilter({
    minContentLength: 50,
    excludeText: ['Python'],
    dateRange: {
      from: new Date('2023-01-01'),
      to: new Date('2023-03-31')
    }
  })
  
  const combinedFilteredPages = await combinedFilter.filterPages(samplePages)
  console.log(`Result: ${samplePages.size} pages before, ${combinedFilteredPages.size} pages after filtering`)
  console.log('Remaining pages:', Array.from(combinedFilteredPages.keys()).join(', '))
  console.log()
  
  // Test 6: Custom filter function
  console.log('Test 6: Custom filter function (only pages with "Test" in title)')
  const customFilter = new ContentFilter({
    customFilter: (page) => page.title.includes('Test')
  })
  
  const customFilteredPages = await customFilter.filterPages(samplePages)
  console.log(`Result: ${samplePages.size} pages before, ${customFilteredPages.size} pages after filtering`)
  console.log('Remaining pages:', Array.from(customFilteredPages.keys()).join(', '))
  console.log()
  
  // Test 7: Using the simple filterPages function
  console.log('Test 7: Using filterPages utility function')
  const utilFilteredPages = await filterPages(samplePages, {
    minContentLength: 100,
    includeText: ['web', 'guide']
  })
  
  console.log(`Result: ${samplePages.size} pages before, ${utilFilteredPages.size} pages after filtering`)
  console.log('Remaining pages:', Array.from(utilFilteredPages.keys()).join(', '))
}

// Run the tests
testContentFiltering().catch(console.error)

/*
Expected output:

Testing content filtering...

Test 1: Filter by minimum content length (> 50 characters)
Result: 4 pages before, 3 pages after filtering
Remaining pages: /page2, /page3, /page4

Test 2: Filter by included text (must contain "JavaScript")
Result: 4 pages before, 1 pages after filtering
Remaining pages: /page2

Test 3: Filter by excluded text (must not contain "Python")
Result: 4 pages before, 3 pages after filtering
Remaining pages: /page1, /page2, /page4

Test 4: Filter by date range (Feb 2023 - Mar 2023)
Result: 4 pages before, 2 pages after filtering
Remaining pages: /page2, /page3

Test 5: Combined filters (min length 50, exclude "Python", between Jan-Mar 2023)
Result: 4 pages before, 1 pages after filtering
Remaining pages: /page2

Test 6: Custom filter function (only pages with "Test" in title)
Result: 4 pages before, 4 pages after filtering
Remaining pages: /page1, /page2, /page3, /page4

Test 7: Using filterPages utility function
Result: 4 pages before, 1 pages after filtering
Remaining pages: /page4
*/
