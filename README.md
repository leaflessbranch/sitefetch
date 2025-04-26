# sitefetch

Fetch an entire site and save it as a text file (to be used with AI models).

![image](https://github.com/user-attachments/assets/e6877428-0e1c-444a-b7af-2fb21ded8814)

## Install

One-off usage (choose one of the followings):

```bash
bunx sitefetch
npx sitefetch
pnpx sitefetch
```

Install globally (choose one of the followings):

```bash
bun i -g sitefetch
npm i -g sitefetch
pnpm i -g sitefetch
```

## Usage

```bash
sitefetch https://egoist.dev -o site.txt

# or better concurrency
sitefetch https://egoist.dev -o site.txt --concurrency 10

# with custom rate limiting
sitefetch https://egoist.dev -o site.txt --rate-limit 2 --min-delay 500
```

### Match specific pages

Use the `-m, --match` flag to specify the pages you want to fetch:

```bash
sitefetch https://vite.dev -m "/blog/**" -m "/guide/**"
```

The match pattern is tested against the pathname of target pages, powered by micromatch, you can check out all the supported [matching features](https://github.com/micromatch/micromatch#matching-features).

### Content selector

We use [mozilla/readability](https://github.com/mozilla/readability) to extract readable content from the web page, but on some pages it might return irrelevant contents, in this case you can specify a CSS selector so we know where to find the readable content:

```bash
sitefetch https://vite.dev --content-selector ".content"
```

### Rate Limiting

Sitefetch includes intelligent rate limiting to avoid overloading websites and to handle rate limits gracefully. You can customize the rate limiting behavior:

```bash
# Set maximum requests per second
sitefetch https://example.com -o site.txt --rate-limit 2

# Set minimum delay between requests (in milliseconds)
sitefetch https://example.com -o site.txt --min-delay 500

# Disable adaptive rate limiting
sitefetch https://example.com -o site.txt --no-adaptive

# Ignore robots.txt crawl-delay directives
sitefetch https://example.com -o site.txt --no-robots

# Set custom rate limits for specific hosts
sitefetch https://example.com -o site.txt --host-limits '{"example.com":{"requestsPerSecond":1,"minDelay":1000}}'
```

By default, sitefetch:

1. Respects robots.txt crawl-delay directives
2. Uses adaptive rate limiting based on server responses
3. Automatically detects rate limit responses and backs off
4. Limits to 5 requests per second by default

### Content Filtering

Sitefetch provides powerful content filtering capabilities to help you focus on relevant content:

```bash
# Include only pages that contain specific text
sitefetch https://example.com -o site.txt --include-text "javascript" --include-text "tutorial"

# Exclude pages that contain specific text
sitefetch https://example.com -o site.txt --exclude-text "legacy" --exclude-text "deprecated"

# Filter by content length
sitefetch https://example.com -o site.txt --min-content-length 500 --max-content-length 10000

# Filter by date range
sitefetch https://example.com -o site.txt --date-from "2023-01-01" --date-to "2023-12-31"

# Combine multiple filters
sitefetch https://example.com -o site.txt --include-text "javascript" --min-content-length 1000 --date-from "2023-01-01"
```

Filtering is applied both during fetching and as a post-processing step, ensuring you only get the content you're interested in.

### Caching System

SiteFetch includes an intelligent caching system to avoid unnecessary requests and improve performance:

```bash
# Enable caching (creates a .sitefetch-cache directory by default)
sitefetch https://example.com -o site.txt --cache

# Specify a custom cache directory
sitefetch https://example.com -o site.txt --cache --cache-dir "./my-cache"

# Set cache TTL (time-to-live) in seconds (default: 3600 - 1 hour)
sitefetch https://example.com -o site.txt --cache --cache-ttl 86400

# Use a specific namespace for cache isolation
sitefetch https://example.com -o site.txt --cache --cache-namespace "project1"

# Disable caching explicitly
sitefetch https://example.com -o site.txt --no-cache
```

The caching system:

1. Automatically stores fetched pages with configurable TTL
2. Uses gzip compression to reduce disk usage
3. Provides validation mechanisms to ensure cache freshness
4. Includes size management to prevent unbounded growth
5. Works seamlessly with all other features

### Custom Request Configuration

SiteFetch provides advanced HTTP request configuration options:

```bash
# Set custom user agent
sitefetch https://example.com -o site.txt --user-agent "My Custom Bot (https://mybot.example)"

# Include cookies with requests
sitefetch https://example.com -o site.txt --cookies '{"session":"abc123","preference":"dark-mode"}'

# Use a proxy server
sitefetch https://example.com -o site.txt --proxy "http://user:pass@proxy.example.com:8080"

# SSL/TLS configuration
sitefetch https://example.com -o site.txt --no-verify-ssl --cert "./client.crt" --key "./client.key"

# Control redirect behavior
sitefetch https://example.com -o site.txt --no-follow-redirects
sitefetch https://example.com -o site.txt --max-redirects 5

# Set maximum response size
sitefetch https://example.com -o site.txt --max-response-size 10485760  # 10MB limit
```

The request configuration system supports:

1. Custom HTTP headers and User-Agent
2. Cookie management with automatic handling of Set-Cookie headers
3. Proxy server configuration
4. SSL/TLS options including certificate verification control
5. Fine-grained control over redirects
6. Response size limits for security
7. Automatic retry with exponential backoff

### Error Handling

Sitefetch provides robust error handling capabilities to deal with network failures and other issues:

```bash
# Set number of retries for failed requests
sitefetch https://example.com -o site.txt --retries 5

# Configure delay between retries (in milliseconds)
sitefetch https://example.com -o site.txt --retry-delay 2000

# Continue fetching other pages despite errors
sitefetch https://example.com -o site.txt --continue-on-error
```

The error handling system features:

1. Intelligent retry mechanism with exponential backoff
2. Differentiation between retryable and non-retryable errors
3. Detailed error reporting for debugging
4. Ability to continue processing despite failures on certain pages

### Enhanced Metadata Extraction

Sitefetch can extract and preserve rich metadata from web pages:

```bash
# Enable metadata extraction
sitefetch https://example.com -o site.txt --extract-metadata

# Extract JSON-LD structured data
sitefetch https://example.com -o site.txt --extract-json-ld

# Extract microdata from HTML attributes
sitefetch https://example.com -o site.txt --extract-microdata

# Disable specific metadata types
sitefetch https://example.com -o site.txt --extract-metadata --no-metadata-authors
sitefetch https://example.com -o site.txt --extract-metadata --no-metadata-dates
```

The metadata system extracts:

1. Publication dates and modification timestamps
2. Author information
3. Meta tags and OpenGraph properties
4. Twitter card metadata
5. JSON-LD structured data
6. Microdata embedded in HTML

### Pagination Support

Sitefetch automatically detects and follows pagination to capture multi-page content:

```bash
# Enable pagination with default settings
sitefetch https://example.com/blog -o blog.txt --pagination

# Limit the maximum number of pages to follow per starting URL
sitefetch https://example.com/blog -o blog.txt --pagination --max-pages 5

# Specify pagination detection strategy
sitefetch https://example.com/blog -o blog.txt --pagination --strategy next-link
```

The pagination system:

1. Automatically detects common pagination patterns
2. Preserves page numbering and ordering in the output
3. Supports various pagination implementations (numbered links, "next" buttons)
4. Configurable depth limits to prevent endless crawling

### Resumable Operations

Sitefetch supports checkpointing and resumable operations for handling large sites or dealing with interruptions:

```bash
# Enable resumable operations
sitefetch https://example.com -o site.txt --resume

# Resume a previously interrupted run
sitefetch https://example.com -o site.txt --resume --resume-from "checkpoint-abc123"

# Configure checkpoint directory
sitefetch https://example.com -o site.txt --resume --checkpoint-dir "./checkpoints"

# Set checkpoint interval (in milliseconds)
sitefetch https://example.com -o site.txt --resume --checkpoint-interval 60000

# Specify a custom checkpoint ID
sitefetch https://example.com -o site.txt --resume --checkpoint-id "my-project"
```

The resumable operations system:

1. Creates periodic checkpoints of crawl progress
2. Preserves successful fetches and tracks pending URLs
3. Can be resumed after interruptions or failures
4. Configurable checkpoint frequency and storage

### Content Transformation

Sitefetch can output content in various formats and with different processing options:

```bash
# Choose output format
sitefetch https://example.com -o site.json --format json
sitefetch https://example.com -o site.xml --format xml
sitefetch https://example.com -o site.csv --format csv
sitefetch https://example.com -o site.html --format html

# Format options
sitefetch https://example.com -o site.json --format json --pretty-print
sitefetch https://example.com -o site.txt --no-excess-whitespace
sitefetch https://example.com -o site.txt --no-line-breaks
```

Supported output formats:

- `markdown` (default): Convert HTML to GitHub-flavored Markdown
- `text`: Extract plain text content
- `html`: Preserve HTML content with optional cleaning
- `json`: JSON format with each page as an object
- `xml`: XML format with proper escaping
- `csv`: CSV format with basic fields

### Progress Tracking

SiteFetch provides real-time progress tracking to monitor the status of your fetching operations:

```bash
# Enable progress tracking with default settings
sitefetch https://example.com -o site.txt --progress

# Disable progress display
sitefetch https://example.com -o site.txt --no-progress

# Customize progress update frequency (in milliseconds)
sitefetch https://example.com -o site.txt --progress-update-interval 2000

# Adjust progress bar width
sitefetch https://example.com -o site.txt --progress-bar-width 50

# Disable progress bar but keep statistical updates
sitefetch https://example.com -o site.txt --no-progress-bar
```

The progress tracking system provides:

1. Real-time visualization with customizable CLI progress bar
2. Detailed statistics on success rate, pages per second, and estimated time remaining
3. Events for tracking fetch successes, failures, and skipped pages
4. Programmatic access to progress data through the API

## API

```ts
import { fetchSite } from "sitefetch"

await fetchSite("https://egoist.dev", {
  //...options
})
```

For programmatic access to progress events, you can use the API with progress callbacks:

```ts
import { fetchSite } from "sitefetch"

await fetchSite("https://egoist.dev", {
  // Enable progress tracking
  progress: {
    enabled: true,
    // Callback for overall progress updates
    onProgress: (stats) => {
      console.log(`Progress: ${stats.percentComplete}%, Speed: ${stats.pagesPerSecond} p/s`)
    },
    // Callback for successful page fetches
    onPageFetched: (data) => {
      console.log(`Fetched: ${data.url} in ${data.timeMs}ms`)
    },
    // Callback for failed page fetches
    onPageFailed: (data) => {
      console.log(`Failed: ${data.url} - ${data.error.message}`)
    }
  }
})
```

For more advanced use cases, you can use the more granular API objects:

```ts
import { 
  Fetcher, 
  RateLimiter, 
  Cache, 
  ContentFilter, 
  MetadataExtractor, 
  ProgressTracker,
  ResumeHandler
} from "sitefetch"

// Create instances of the components you need
const rateLimiter = new RateLimiter({
  requestsPerSecond: 3,
  adaptive: true
})

const cache = new Cache({
  enabled: true,
  directory: './cache',
  ttl: 3600
})

// Create a fetcher with all options
const fetcher = new Fetcher({
  concurrency: 5,
  rateLimit: rateLimiter,
  cache: cache,
  // Other options...
})

// Start fetching
const pages = await fetcher.fetchSite("https://example.com")

// Get statistics
const stats = fetcher.getStats()
console.log(`Fetched ${stats.pagesCount} pages`)

// Apply filtering after fetching
const filteredPages = await fetcher.applyFiltering()
```

Check out detailed options in [types.ts](./src/types.ts).

## Plug

If you like this, please check out my LLM chat app: https://chatwise.app

## License

MIT.
