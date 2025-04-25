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

## Plug

If you like this, please check out my LLM chat app: https://chatwise.app

## API

```ts
import { fetchSite } from "sitefetch"

await fetchSite("https://egoist.dev", {
  //...options
})
```

Check out options in [types.ts](./src/types.ts).

## License

MIT.
