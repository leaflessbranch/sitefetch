/**
 * Test file for the metadata extraction functionality.
 * In a real project, this would be a proper test suite using Jest or similar.
 */

import { MetadataExtractor, createMetadataExtractor } from './index'

// Sample HTML for testing
const sampleHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>Test Article Page</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="This is a test article for metadata extraction">
  <meta name="author" content="John Doe">
  <meta name="keywords" content="test, metadata, extraction">
  <meta name="date" content="2023-05-15T10:30:00Z">
  <meta property="og:title" content="Test Article - Open Graph">
  <meta property="og:description" content="OG description for testing">
  <meta property="og:image" content="https://example.com/image.jpg">
  <meta property="og:url" content="https://example.com/article">
  <meta property="og:type" content="article">
  <meta property="article:published_time" content="2023-05-15T10:30:00Z">
  <meta property="article:modified_time" content="2023-05-16T14:20:00Z">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Test Article - Twitter Card">
  <meta name="twitter:description" content="Twitter card description for testing">
  <meta name="twitter:image" content="https://example.com/twitter-image.jpg">
  <link rel="canonical" href="https://example.com/article">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "Test Article - JSON-LD",
    "author": {
      "@type": "Person",
      "name": "John Doe",
      "url": "https://example.com/author/john-doe"
    },
    "datePublished": "2023-05-15T10:30:00Z",
    "dateModified": "2023-05-16T14:20:00Z",
    "image": "https://example.com/image.jpg",
    "publisher": {
      "@type": "Organization",
      "name": "Example Publisher",
      "logo": {
        "@type": "ImageObject",
        "url": "https://example.com/logo.jpg"
      }
    }
  }
  </script>
</head>
<body>
  <article itemscope itemtype="http://schema.org/Article">
    <header>
      <h1 itemprop="headline">Test Article - Microdata</h1>
      <div class="byline">
        By <a href="https://example.com/author/john-doe" rel="author" itemprop="author">John Doe</a>
      </div>
      <time datetime="2023-05-15T10:30:00Z" itemprop="datePublished">May 15, 2023</time>
      <time datetime="2023-05-16T14:20:00Z" itemprop="dateModified">Updated: May 16, 2023</time>
    </header>
    <div itemprop="articleBody">
      <p>This is a test article for metadata extraction published on May 15, 2023.</p>
      <p>The article was written by Jane Smith and edited by John Doe.</p>
    </div>
    <footer>
      <div class="author-bio">
        <h3>About the Author</h3>
        <div class="author">John Doe is a technical writer with expertise in metadata.</div>
      </div>
    </footer>
  </article>
</body>
</html>
`

// Test the metadata extractor
async function testMetadataExtractor() {
  console.log('Testing metadata extraction...')
  
  const extractor = new MetadataExtractor()
  
  try {
    const metadata = extractor.extract(sampleHtml, 'https://example.com/article')
    
    console.log('\nExtracted metadata:')
    console.log(JSON.stringify(metadata, null, 2))
    
    // Test specific extractors
    console.log('\nTesting individual extractors:')
    
    // Test with limited options
    const limitedExtractor = new MetadataExtractor({
      extractDates: true,
      extractAuthors: true,
      extractOpenGraph: false,
      extractTwitterCard: false,
      extractJsonLd: false,
      extractMicrodata: false,
    })
    
    const limitedMetadata = limitedExtractor.extract(sampleHtml, 'https://example.com/article')
    
    console.log('\nLimited metadata (dates and authors only):')
    console.log(JSON.stringify(limitedMetadata, null, 2))
    
    // Test with custom extractor
    const customExtractor = new MetadataExtractor({
      customExtractors: [
        ($, url) => {
          // Custom extractor to get all heading text
          const headings: string[] = []
          
          $('h1, h2, h3').each((_, el) => {
            headings.push($(el).text().trim())
          })
          
          return { headings }
        }
      ]
    })
    
    const customMetadata = customExtractor.extract(sampleHtml, 'https://example.com/article')
    
    console.log('\nMetadata with custom extractor:')
    console.log(JSON.stringify(customMetadata, null, 2))
    
    // Test the utility function
    const utilExtractor = createMetadataExtractor()
    const utilMetadata = utilExtractor.extract(sampleHtml, 'https://example.com/article')
    
    console.log('\nMetadata from utility function:')
    console.log(JSON.stringify(utilMetadata, null, 2))
    
  } catch (error) {
    console.error('Test failed:', error.message)
  }
}

// Uncomment to run the test
// testMetadataExtractor().catch(console.error)

/**
 * Example usage in a real application:
 * 
 * ```typescript
 * import { fetchSite } from './fetcher'
 * import { MetadataExtractor } from './metadata'
 * 
 * // Create a metadata extractor
 * const metadataExtractor = new MetadataExtractor({
 *   extractDates: true,
 *   extractAuthors: true,
 *   extractOpenGraph: true,
 *   extractTwitterCard: true,
 * })
 * 
 * async function fetchWithMetadata(url: string) {
 *   // Fetch the page
 *   const response = await fetch(url)
 *   const html = await response.text()
 *   
 *   // Extract metadata
 *   const metadata = metadataExtractor.extract(html, url)
 *   
 *   // Process the page with metadata
 *   console.log('Page metadata:', metadata)
 *   
 *   // Do something with the metadata
 *   if (metadata.dates?.published) {
 *     console.log(`Published on: ${metadata.dates.published}`)
 *   }
 *   
 *   if (metadata.authors?.names?.length) {
 *     console.log(`Written by: ${metadata.authors.names.join(', ')}`)
 *   }
 * }
 * ```
 */
