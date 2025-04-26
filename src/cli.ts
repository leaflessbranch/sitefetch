import path from "node:path"
import fs from "node:fs"
import { cac } from "cac"
import { encode } from "gpt-tokenizer/model/gpt-4o"
import { fetchSite, serializePages, Fetcher, ResumeHandler } from "./index.ts"
import { logger } from "./logger.ts"
import { ensureArray, formatNumber } from "./utils.ts"
import { version } from "../package.json"

const cli = cac("sitefetch")

cli
  .command("[url]", "Fetch a site")
  .option("-o, --outfile <path>", "Write the fetched site to a text file")
  .option("--concurrency <number>", "Number of concurrent requests", {
    default: 3,
  })
  .option("-m, --match <pattern>", "Only fetch matched pages")
  .option("--content-selector <selector>", "The CSS selector to find content")
  .option("--limit <limit>", "Limit the result to this amount of pages")
  .option("--rate-limit <number>", "Maximum requests per second (default: 5)")
  .option(
    "--min-delay <number>",
    "Minimum delay between requests in ms (default: 200)"
  )
  .option("--no-adaptive", "Disable adaptive rate limiting")
  .option("--no-robots", "Ignore robots.txt crawl-delay directives")
  .option(
    "--host-limits <json>",
    "Custom rate limits for specific hosts (JSON string)"
  )
  .option(
    "--max-concurrent <number>",
    "Maximum concurrent requests (default: 3)"
  )
  .option(
    "--time-window <ms>",
    "Time window for rate limiting in milliseconds (default: 1000)"
  )
  .option(
    "--default-delay <ms>",
    "Default delay for hosts with no explicit rate limit (default: 1000)"
  )
  .option(
    "--no-detect-rate-limits",
    "Disable automatic detection of rate limit responses"
  )
  .option(
    "--format <format>",
    "Output format (markdown, text, html, json, xml, csv)"
  )
  .option("--pretty-print", "Pretty print the output")
  .option("--no-excess-whitespace", "Remove excessive whitespace")
  .option("--no-line-breaks", "Remove consecutive line breaks")
  // Markdown-specific options
  .option(
    "--heading-style <style>",
    "Heading style for markdown (atx or setext)"
  )
  .option(
    "--code-block-style <style>",
    "Code block style for markdown (fenced or indented)"
  )
  .option(
    "--bullet-list-marker <char>",
    "Bullet list marker for markdown (*, +, or -)"
  )
  .option("--list-item-spacing", "Add spacing between list items")
  // HTML-specific options
  .option("--xml-mode", "Output HTML as XML")
  .option("--remove-scripts", "Remove script tags from HTML output")
  .option("--remove-styles", "Remove style tags from HTML output")
  .option("--remove-comments", "Remove HTML comments")
  .option("--remove-inline-styles", "Remove inline style attributes")
  .option("--remove-classes", "Remove class attributes")
  .option("--remove-data-attributes", "Remove data attributes")
  .option("--remove-event-handlers", "Remove event handlers (onclick, etc.)")
  .option("--remove-forms", "Remove forms and form elements")
  // Text-specific options
  .option(
    "--plain-text-headings",
    "Format headings in plain text (e.g., '# Heading')"
  )
  .option("--include-links", "Include URLs after link text")
  .option("--silent", "Do not print any logs")
  .option(
    "--include-text <pattern>",
    "Only include pages containing specific text"
  )
  .option("--exclude-text <pattern>", "Exclude pages containing specific text")
  .option(
    "--min-content-length <number>",
    "Minimum content length in characters"
  )
  .option(
    "--max-content-length <number>",
    "Maximum content length in characters"
  )
  .option(
    "--date-from <date>",
    "Only include pages with date on or after (YYYY-MM-DD)"
  )
  .option(
    "--date-to <date>",
    "Only include pages with date on or before (YYYY-MM-DD)"
  )
  .option("--cache", "Enable caching of fetched pages")
  .option("--no-cache", "Disable caching of fetched pages")
  .option("--cache-dir <path>", "Directory to store cache files")
  .option(
    "--cache-ttl <seconds>",
    "Time-to-live for cached pages in seconds (default: 3600)"
  )
  .option("--cache-namespace <name>", "Namespace for cache files")
  .option(
    "--cache-compression-level <level>",
    "Compression level for cache (0-9, 0 = no compression, 9 = max compression)"
  )
  .option(
    "--cache-max-size <bytes>",
    "Maximum cache size in bytes (default: unlimited)"
  )
  .option("--extract-metadata", "Enable metadata extraction")
  .option("--no-metadata-dates", "Disable extraction of publication dates")
  .option("--no-metadata-authors", "Disable extraction of author information")
  .option("--no-metadata-meta-tags", "Disable extraction of meta tags")
  .option("--no-metadata-opengraph", "Disable extraction of OpenGraph metadata")
  .option(
    "--no-metadata-twitter",
    "Disable extraction of Twitter card metadata"
  )
  .option("--extract-json-ld", "Enable extraction of JSON-LD structured data")
  .option(
    "--extract-microdata",
    "Enable extraction of microdata from HTML attributes"
  )
  .option("--progress", "Enable progress tracking and display")
  .option("--no-progress", "Disable progress tracking and display")
  .option(
    "--progress-update-interval <ms>",
    "Progress update interval in milliseconds"
  )
  .option(
    "--progress-bar-width <width>",
    "Width of the progress bar in characters"
  )
  .option("--no-progress-bar", "Disable progress bar display")
  .option(
    "--progress-bar-char <char>",
    "Character to use for filled portion of progress bar (default: \u2588)"
  )
  .option(
    "--incomplete-char <char>",
    "Character to use for unfilled portion of progress bar (default: \u2591)"
  )
  .option("--no-show-stats", "Disable detailed progress statistics")
  .option("--resume", "Enable resumable operations")
  .option("--checkpoint-dir <path>", "Directory to store checkpoint files")
  .option(
    "--checkpoint-interval <ms>",
    "Interval between checkpoints in milliseconds"
  )
  .option("--checkpoint-id <id>", "Custom identifier for the checkpoint")
  .option("--resume-from <id>", "Resume from a specific checkpoint ID")
  .option("--no-compress-checkpoint", "Disable checkpoint compression")
  .option("--max-checkpoints <number>", "Maximum number of checkpoints to keep")
  .option("--checkpoint-format <format>", "File name format for checkpoints")
  .option(
    "--checkpoint-compression-level <level>",
    "Compression level for checkpoints (0-9)"
  )
  // Pagination options
  .option("--pagination", "Enable pagination detection and handling")
  .option("--no-pagination", "Disable pagination detection and handling")
  .option(
    "--max-pages <number>",
    "Maximum number of pages to follow for each starting URL"
  )
  .option(
    "--pagination-strategy <strategy>",
    "Pagination detection strategy (next-link, page-numbers, or auto)"
  )
  .option(
    "--no-auto-detect",
    "Disable automatic detection of pagination elements"
  )
  .option(
    "--next-link-selector <selector>",
    "CSS selector for 'next page' links"
  )
  .option(
    "--page-numbers-selector <selector>",
    "CSS selector for page number links"
  )
  // Add request configuration options
  .option("--timeout <ms>", "Request timeout in milliseconds")
  .option("--user-agent <agent>", "Custom User-Agent header")
  .option("--cookies <json>", "Cookies to include with requests (JSON string)")
  .option("--proxy <url>", "Proxy server to use for requests")
  .option("--no-follow-redirects", "Disable following redirects")
  .option("--max-redirects <number>", "Maximum number of redirects to follow")
  .option("--max-response-size <bytes>", "Maximum response size in bytes")
  .option("--no-verify-ssl", "Disable SSL certificate verification")
  .option("--cert <path>", "Path to client certificate file")
  .option("--key <path>", "Path to client key file")
  .option("--ca <path>", "Path to CA certificate file")
  // Error handling options
  .option("--retries <number>", "Number of retry attempts for failed requests")
  .option("--retry-delay <ms>", "Base delay between retries in milliseconds")
  .option("--continue-on-error", "Continue fetching despite errors")
  .action(async (url, flags) => {
    if (!url) {
      cli.outputHelp()
      return
    }

    if (flags.silent) {
      logger.setLevel("silent")
    }

    // Parse host limits if provided
    let perHostLimits = undefined
    if (flags.hostLimits) {
      try {
        perHostLimits = JSON.parse(flags.hostLimits)
      } catch (error) {
        logger.warn(`Failed to parse host limits: ${error.message}`)
      }
    }

    // Parse filter options
    let filterOptions = undefined
    if (
      flags.includeText ||
      flags.excludeText ||
      flags.minContentLength ||
      flags.maxContentLength ||
      flags.dateFrom ||
      flags.dateTo
    ) {
      filterOptions = {
        includeText: flags.includeText && ensureArray(flags.includeText),
        excludeText: flags.excludeText && ensureArray(flags.excludeText),
        minContentLength:
          flags.minContentLength && parseInt(flags.minContentLength, 10),
        maxContentLength:
          flags.maxContentLength && parseInt(flags.maxContentLength, 10),
      }

      // Parse date range if specified
      if (flags.dateFrom || flags.dateTo) {
        filterOptions.dateRange = {}

        if (flags.dateFrom) {
          try {
            filterOptions.dateRange.from = new Date(flags.dateFrom)
          } catch (error) {
            logger.warn(`Invalid date-from format: ${error.message}`)
          }
        }

        if (flags.dateTo) {
          try {
            filterOptions.dateRange.to = new Date(flags.dateTo)
          } catch (error) {
            logger.warn(`Invalid date-to format: ${error.message}`)
          }
        }
      }
    }

    // Parse cache options
    let cacheOptions = undefined
    if (
      flags.cache !== undefined ||
      flags.cacheDir ||
      flags.cacheTtl ||
      flags.cacheNamespace ||
      flags.cacheCompressionLevel ||
      flags.cacheMaxSize
    ) {
      cacheOptions = {
        enabled: flags.cache !== false, // Default to true if any cache option is specified
        directory: flags.cacheDir,
        ttl: flags.cacheTtl && parseInt(flags.cacheTtl, 10),
        namespace: flags.cacheNamespace,
        compressionLevel:
          flags.cacheCompressionLevel &&
          parseInt(flags.cacheCompressionLevel, 10),
        maxSize: flags.cacheMaxSize && parseInt(flags.cacheMaxSize, 10),
      }
    }

    // Parse metadata options
    let metadataOptions = undefined
    if (
      flags.extractMetadata ||
      flags.metadataDates === false ||
      flags.metadataAuthors === false ||
      flags.metadataMetaTags === false ||
      flags.metadataOpengraph === false ||
      flags.metadataTwitter === false ||
      flags.extractJsonLd ||
      flags.extractMicrodata
    ) {
      metadataOptions = {
        extractDates: flags.metadataDates !== false,
        extractAuthors: flags.metadataAuthors !== false,
        extractMetaTags: flags.metadataMetaTags !== false,
        extractOpenGraph: flags.metadataOpengraph !== false,
        extractTwitterCard: flags.metadataTwitter !== false,
        extractJsonLd: flags.extractJsonLd === true,
        extractMicrodata: flags.extractMicrodata === true,
      }
    }

    // Parse progress options
    let progressOptions: import("./types.ts").ProgressOptions | undefined =
      undefined // Add type for clarity
    const progressFlagsProvided =
      flags.progress !== undefined ||
      flags.progressUpdateInterval ||
      flags.progressBarWidth ||
      flags.progressBar === false ||
      flags.progressBarChar ||
      flags.incompleteChar ||
      flags.showStats === false

    if (progressFlagsProvided) {
      progressOptions = {} // Initialize as an empty object

      // Only set properties if the corresponding flag was provided or relevant
      if (flags.progress !== undefined) {
        progressOptions.enabled = flags.progress !== false
      }
      if (flags.progressUpdateInterval) {
        progressOptions.updateInterval = parseInt(
          flags.progressUpdateInterval,
          10
        )
      }
      if (flags.progressBar !== undefined) {
        // Check if --progress-bar or --no-progress-bar was used
        progressOptions.showProgressBar = flags.progressBar !== false
      }
      if (flags.progressBarWidth) {
        progressOptions.progressBarWidth = parseInt(flags.progressBarWidth, 10)
      }
      if (flags.progressBarChar) {
        // Only set if flag was explicitly provided
        progressOptions.progressBarChar = flags.progressBarChar
      }
      if (flags.incompleteChar) {
        // Only set if flag was explicitly provided
        progressOptions.incompleteChar = flags.incompleteChar
      }
      if (flags.showStats !== undefined) {
        // Check if --show-stats or --no-show-stats was used
        progressOptions.showStats = flags.showStats !== false
      }
      // Ensure enabled is true if any progress option is set but --progress isn't explicitly false
      if (progressOptions.enabled === undefined && flags.progress !== false) {
        progressOptions.enabled = true
      }
      // Ensure showProgressBar is true if relevant options are set but --progress-bar isn't explicitly false
      if (
        progressOptions.showProgressBar === undefined &&
        flags.progressBar !== false &&
        (flags.progressBarWidth ||
          flags.progressBarChar ||
          flags.incompleteChar)
      ) {
        progressOptions.showProgressBar = true
      }
    }

    // Parse resume options
    let resumeOptions = undefined
    if (
      flags.resume !== undefined ||
      flags.checkpointDir ||
      flags.checkpointInterval ||
      flags.checkpointId ||
      flags.compressCheckpoint === false ||
      flags.maxCheckpoints ||
      flags.checkpointFormat ||
      flags.checkpointCompressionLevel
    ) {
      resumeOptions = {
        enabled: flags.resume === true,
        checkpointDir: flags.checkpointDir,
        checkpointInterval:
          flags.checkpointInterval && parseInt(flags.checkpointInterval, 10),
        checkpointId: flags.checkpointId,
        compress: flags.compressCheckpoint !== false,
        maxCheckpoints:
          flags.maxCheckpoints && parseInt(flags.maxCheckpoints, 10),
        checkpointFileFormat: flags.checkpointFormat,
        compressionLevel:
          flags.checkpointCompressionLevel &&
          parseInt(flags.checkpointCompressionLevel, 10),
      }
    }

    // Parse request configuration options
    let requestOptions = undefined
    if (
      flags.timeout ||
      flags.userAgent ||
      flags.cookies ||
      flags.proxy ||
      flags.followRedirects === false ||
      flags.maxRedirects ||
      flags.maxResponseSize ||
      flags.verifySsl === false ||
      flags.cert ||
      flags.key ||
      flags.ca
    ) {
      requestOptions = {
        timeout: flags.timeout && parseInt(flags.timeout, 10),
        userAgent: flags.userAgent,
        followRedirects: flags.followRedirects !== false,
        maxRedirects: flags.maxRedirects && parseInt(flags.maxRedirects, 10),
        maxResponseSize:
          flags.maxResponseSize && parseInt(flags.maxResponseSize, 10),
        headers: {},
        tls: {},
      }

      // Parse cookies if provided as JSON
      if (flags.cookies) {
        try {
          requestOptions.cookies = JSON.parse(flags.cookies)
        } catch (error) {
          logger.warn(`Failed to parse cookies JSON: ${error.message}`)
        }
      }

      // Add proxy if specified
      if (flags.proxy) {
        requestOptions.proxy = flags.proxy
      }

      // Add TLS/SSL options
      if (flags.verifySsl === false) {
        requestOptions.tls.rejectUnauthorized = false
      }

      if (flags.cert) {
        requestOptions.tls.cert = flags.cert
      }

      if (flags.key) {
        requestOptions.tls.key = flags.key
      }

      if (flags.ca) {
        requestOptions.tls.ca = flags.ca
      }

      // Clean up empty objects
      if (Object.keys(requestOptions.tls).length === 0) {
        delete requestOptions.tls
      }
      if (Object.keys(requestOptions.headers).length === 0) {
        delete requestOptions.headers
      }
    }

    // Parse error handling options
    let errorOptions = undefined
    if (flags.retries || flags.retryDelay || flags.continueOnError) {
      errorOptions = {
        retries: flags.retries && parseInt(flags.retries, 10),
        retryDelay: flags.retryDelay && parseInt(flags.retryDelay, 10),
        continueOnError: flags.continueOnError === true,
      }
    }

    // Parse pagination options
    let paginationOptions = undefined
    if (
      flags.pagination !== undefined ||
      flags.maxPages ||
      flags.paginationStrategy ||
      flags.autoDetect === false ||
      flags.nextLinkSelector ||
      flags.pageNumbersSelector
    ) {
      paginationOptions = {
        enabled: flags.pagination !== false,
        maxPages: flags.maxPages && parseInt(flags.maxPages, 10),
        strategy: flags.paginationStrategy,
        autoDetect: flags.autoDetect !== false,
        selectors: {
          nextLink: flags.nextLinkSelector,
          pageNumbers: flags.pageNumbersSelector,
        },
      }
    }

    // Initialize resume handler separately to capture checkpoint ID
    let resumeHandler: ResumeHandler | undefined = undefined
    if (resumeOptions?.enabled) {
      resumeHandler = new ResumeHandler(resumeOptions)
    }

    const pages = await fetchSite(
      url,
      {
        concurrency: flags.concurrency,
        match: flags.match && ensureArray(flags.match),
        contentSelector: flags.contentSelector,
        limit: flags.limit,
        rateLimit: {
          requestsPerSecond: flags.rateLimit,
          minDelay: flags.minDelay,
          adaptive: flags.adaptive !== false,
          respectRobotsTxt: flags.robots !== false,
          perHostLimits: perHostLimits,
          maxConcurrent:
            flags.maxConcurrent && parseInt(flags.maxConcurrent, 10),
          timeWindow: flags.timeWindow && parseInt(flags.timeWindow, 10),
          defaultDelay: flags.defaultDelay && parseInt(flags.defaultDelay, 10),
          detectRateLimits: flags.detectRateLimits !== false,
        },
        filter: filterOptions,
        transform: {
          format: flags.format,
          prettyPrint: flags.prettyPrint === true,
          removeExcessWhitespace: flags.excessWhitespace === false,
          removeLineBreaks: flags.lineBreaks === false,
          // Markdown-specific options
          headingStyle: flags.headingStyle,
          codeBlockStyle: flags.codeBlockStyle,
          bulletListMarker: flags.bulletListMarker,
          listItemSpacing: flags.listItemSpacing === true,
          // HTML-specific options
          xmlMode: flags.xmlMode === true,
          removeScripts: flags.removeScripts === true,
          removeStyles: flags.removeStyles === true,
          removeComments: flags.removeComments === true,
          removeInlineStyles: flags.removeInlineStyles === true,
          removeClasses: flags.removeClasses === true,
          removeDataAttributes: flags.removeDataAttributes === true,
          removeEventHandlers: flags.removeEventHandlers === true,
          removeForms: flags.removeForms === true,
          // Text-specific options
          plainTextHeadings: flags.plainTextHeadings === true,
          includeLinks: flags.includeLinks === true,
        },
        cache: cacheOptions,
        metadata: metadataOptions,
        request: requestOptions,
        progress: progressOptions,
        pagination: paginationOptions,
        resume: resumeOptions,
        errors: errorOptions,
      },
      flags.resumeFrom
    )

    if (pages.size === 0) {
      logger.warn("No pages found")
      return
    }

    const pagesArr = [...pages.values()]

    // Define the special tokens used by gpt-4o that might appear literally
    // Add others if needed, e.g., <|im_start|>, <|im_end|> if they cause issues
    const specialTokens = [
      "<|endoftext|>",
      "<|fim_prefix|>",
      "<|fim_middle|>",
      "<|fim_suffix|>",
      "<|endofprompt|>",
    ]
    // Create a regex to match any of these tokens globally
    // Escape special characters in the tokens for regex usage
    const escapedTokens = specialTokens.map(
      (token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") // Escape regex special chars
    )
    const specialTokenRegex = new RegExp(escapedTokens.join("|"), "g")

    const totalTokenCount = pagesArr.reduce((acc, page) => {
      try {
        // Remove the special tokens before encoding
        const cleanedContent = page.content.replace(specialTokenRegex, "") // Replace with empty string
        return acc + encode(cleanedContent).length
      } catch (e) {
        // Should not happen with cleaning, but good practice
        logger.warn(
          `Could not encode content for page ${page.url}: ${e.message}`
        )
        return acc // Add 0 for this page if encoding still fails
      }
    }, 0)

    logger.info(
      `Total token count for ${pages.size} pages: ${formatNumber(
        totalTokenCount
      )}`
    )

    // Display checkpoint ID if resumable operations were enabled
    if (resumeHandler && resumeHandler.getCheckpointData()) {
      const checkpointData = resumeHandler.getCheckpointData()
      logger.info(`Checkpoint ID: ${checkpointData.id}`)
      logger.info(
        `To resume later, use: --resume --resume-from ${checkpointData.id}`
      )
    }

    if (flags.outfile) {
      const format =
        flags.format || (flags.outfile.endsWith(".json") ? "json" : "text")
      const output = serializePages(pages, format, {
        prettyPrint: flags.prettyPrint === true,
        removeExcessWhitespace: flags.excessWhitespace === false,
        removeLineBreaks: flags.lineBreaks === false,
        // Markdown-specific options
        headingStyle: flags.headingStyle,
        codeBlockStyle: flags.codeBlockStyle,
        bulletListMarker: flags.bulletListMarker,
        listItemSpacing: flags.listItemSpacing === true,
        // HTML-specific options
        xmlMode: flags.xmlMode === true,
        removeScripts: flags.removeScripts === true,
        removeStyles: flags.removeStyles === true,
        removeComments: flags.removeComments === true,
        removeInlineStyles: flags.removeInlineStyles === true,
        removeClasses: flags.removeClasses === true,
        removeDataAttributes: flags.removeDataAttributes === true,
        removeEventHandlers: flags.removeEventHandlers === true,
        removeForms: flags.removeForms === true,
        // Text-specific options
        plainTextHeadings: flags.plainTextHeadings === true,
        includeLinks: flags.includeLinks === true,
      })
      fs.mkdirSync(path.dirname(flags.outfile), { recursive: true })
      fs.writeFileSync(flags.outfile, output, "utf8")
      logger.info(`Output written to ${flags.outfile}`)
    } else {
      // Default to text format for console output
      const format = flags.format || "text"
      console.log(
        serializePages(pages, format, {
          prettyPrint: flags.prettyPrint === true,
          removeExcessWhitespace: flags.excessWhitespace === false,
          removeLineBreaks: flags.lineBreaks === false,
          // Markdown-specific options
          headingStyle: flags.headingStyle,
          codeBlockStyle: flags.codeBlockStyle,
          bulletListMarker: flags.bulletListMarker,
          listItemSpacing: flags.listItemSpacing === true,
          // HTML-specific options
          xmlMode: flags.xmlMode === true,
          removeScripts: flags.removeScripts === true,
          removeStyles: flags.removeStyles === true,
          removeComments: flags.removeComments === true,
          removeInlineStyles: flags.removeInlineStyles === true,
          removeClasses: flags.removeClasses === true,
          removeDataAttributes: flags.removeDataAttributes === true,
          removeEventHandlers: flags.removeEventHandlers === true,
          removeForms: flags.removeForms === true,
          // Text-specific options
          plainTextHeadings: flags.plainTextHeadings === true,
          includeLinks: flags.includeLinks === true,
        })
      )
    }
  })

cli.version(version)
cli.help()
cli.parse()
