/**
 * This is a simple test script for the pagination handling functionality.
 * In a real project, this would be a proper test suite using Jest or similar.
 */

import { load } from 'cheerio'
import { PaginationHandler } from './pagination'

// Sample HTML with "next page" link
const sampleHtml1 = `
<!DOCTYPE html>
<html>
<head>
  <title>Sample Pagination Page 1</title>
</head>
<body>
  <div class="content">
    <h1>Sample Content</h1>
    <p>This is page 1 of the content.</p>
  </div>
  <div class="pagination">
    <a href="/page/1" class="current">1</a>
    <a href="/page/2">2</a>
    <a href="/page/3">3</a>
    <a href="/page/2" class="next">Next</a>
  </div>
</body>
</html>
`

// Sample HTML with pagination but no explicit "next" link
const sampleHtml2 = `
<!DOCTYPE html>
<html>
<head>
  <title>Sample Pagination Page 1</title>
</head>
<body>
  <div class="content">
    <h1>Sample Content</h1>
    <p>This is page 1 of the content.</p>
    <p>Page 1 of 5</p>
  </div>
  <div class="pagination">
    <a href="/blog?page=1" class="current">1</a>
    <a href="/blog?page=2">2</a>
    <a href="/blog?page=3">3</a>
    <a href="/blog?page=4">4</a>
    <a href="/blog?page=5">5</a>
  </div>
</body>
</html>
`

// Sample HTML with rel="next" attribute
const sampleHtml3 = `
<!DOCTYPE html>
<html>
<head>
  <title>Sample Pagination Page 1</title>
  <link rel="next" href="/articles/page/2">
</head>
<body>
  <div class="content">
    <h1>Sample Content</h1>
    <p>This is page 1 of the content.</p>
  </div>
  <nav class="navigation pagination">
    <span>Page 1 of 10</span>
    <a href="/articles/page/2" rel="next">Next page</a>
  </nav>
</body>
</html>
`

// Test basic pagination detection
async function testBasicPagination() {
  const handler = new PaginationHandler({
    enabled: true,
    maxPages: 5,
  })

  const $ = load(sampleHtml1)
  const urls = await handler.detectPagination($, 'https://example.com/page/1', sampleHtml1)
  
  console.log('Basic pagination detection:')
  console.log(urls)
  
  // Test metadata extraction
  const metadata = handler.extractPaginationMetadata($, 'https://example.com/page/1')
  console.log('Pagination metadata:')
  console.log(metadata)
}

// Test page number detection
async function testPageNumberPagination() {
  const handler = new PaginationHandler({
    enabled: true,
    maxPages: 5,
    strategy: 'page-numbers',
  })

  const $ = load(sampleHtml2)
  const urls = await handler.detectPagination($, 'https://example.com/blog?page=1', sampleHtml2)
  
  console.log('\nPage number pagination detection:')
  console.log(urls)
  
  // Test metadata extraction
  const metadata = handler.extractPaginationMetadata($, 'https://example.com/blog?page=1')
  console.log('Pagination metadata:')
  console.log(metadata)
}

// Test rel="next" detection
async function testRelNextPagination() {
  const handler = new PaginationHandler({
    enabled: true,
    maxPages: 5,
  })

  const $ = load(sampleHtml3)
  const urls = await handler.detectPagination($, 'https://example.com/articles/page/1', sampleHtml3)
  
  console.log('\nrel="next" pagination detection:')
  console.log(urls)
  
  // Test metadata extraction
  const metadata = handler.extractPaginationMetadata($, 'https://example.com/articles/page/1')
  console.log('Pagination metadata:')
  console.log(metadata)
}

// Uncomment to run the tests
// (async () => {
//   await testBasicPagination()
//   await testPageNumberPagination()
//   await testRelNextPagination()
// })().catch(console.error)

// Example of how to use pagination in the real application:
/* 
import { load } from 'cheerio'
import { PaginationHandler } from './pagination'

// In Fetcher class
const paginationHandler = new PaginationHandler(this.options.pagination)

async function fetchPageWithPagination(url: string) {
  // Fetch the initial page
  const response = await fetch(url)
  const html = await response.text()
  const $ = load(html)
  
  // Process the initial page content
  // ...
  
  // Detect pagination
  const paginationUrls = await paginationHandler.detectPagination($, url, html)
  
  // Extract pagination metadata
  const paginationMeta = paginationHandler.extractPaginationMetadata($, url)
  
  // Add pagination metadata to the page object
  const page = {
    url,
    title: $('title').text(),
    content: extractContent($),
    pagination: paginationMeta,
  }
  
  // Queue the pagination URLs for fetching
  for (const pageUrl of paginationUrls) {
    this.queue.add(() => this.fetchPage(pageUrl))
  }
  
  return page
}
*/
