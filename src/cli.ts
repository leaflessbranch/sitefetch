import path from "node:path"
import fs from "node:fs"
import { cac } from "cac"
import { encode } from "gpt-tokenizer/model/gpt-4o"
import { fetchSite, serializePages } from "./index.ts"
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
  .option("--min-delay <number>", "Minimum delay between requests in ms (default: 200)")
  .option("--no-adaptive", "Disable adaptive rate limiting")
  .option("--no-robots", "Ignore robots.txt crawl-delay directives")
  .option("--host-limits <json>", "Custom rate limits for specific hosts (JSON string)")
  .option("--format <format>", "Output format (markdown, text, html, json, xml, csv)")
  .option("--pretty-print", "Pretty print the output")
  .option("--no-excess-whitespace", "Remove excessive whitespace")
  .option("--no-line-breaks", "Remove consecutive line breaks")
  .option("--silent", "Do not print any logs")
  .option("--include-text <pattern>", "Only include pages containing specific text")
  .option("--exclude-text <pattern>", "Exclude pages containing specific text")
  .option("--min-content-length <number>", "Minimum content length in characters")
  .option("--max-content-length <number>", "Maximum content length in characters")
  .option("--date-from <date>", "Only include pages with date on or after (YYYY-MM-DD)")
  .option("--date-to <date>", "Only include pages with date on or before (YYYY-MM-DD)")
  .option("--cache", "Enable caching of fetched pages")
  .option("--no-cache", "Disable caching of fetched pages")
  .option("--cache-dir <path>", "Directory to store cache files")
  .option("--cache-ttl <seconds>", "Time-to-live for cached pages in seconds (default: 3600)")
  .option("--cache-namespace <name>", "Namespace for cache files")
  .option("--extract-metadata", "Enable metadata extraction")
  .option("--no-metadata-dates", "Disable extraction of publication dates")
  .option("--no-metadata-authors", "Disable extraction of author information")
  .option("--no-metadata-meta-tags", "Disable extraction of meta tags")
  .option("--no-metadata-opengraph", "Disable extraction of OpenGraph metadata")
  .option("--no-metadata-twitter", "Disable extraction of Twitter card metadata")
  .option("--extract-json-ld", "Enable extraction of JSON-LD structured data")
  .option("--extract-microdata", "Enable extraction of microdata from HTML attributes")
  .option("--progress", "Enable progress tracking and display")
  .option("--no-progress", "Disable progress tracking and display")
  .option("--progress-update-interval <ms>", "Progress update interval in milliseconds")
  .option("--progress-bar-width <width>", "Width of the progress bar in characters")
  .option("--no-progress-bar", "Disable progress bar display")
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
        minContentLength: flags.minContentLength && parseInt(flags.minContentLength, 10),
        maxContentLength: flags.maxContentLength && parseInt(flags.maxContentLength, 10),
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
    if (flags.cache !== undefined || flags.cacheDir || flags.cacheTtl || flags.cacheNamespace) {
      cacheOptions = {
        enabled: flags.cache !== false, // Default to true if any cache option is specified
        directory: flags.cacheDir,
        ttl: flags.cacheTtl && parseInt(flags.cacheTtl, 10),
        namespace: flags.cacheNamespace
      }
    }
    
    // Parse metadata options
    let metadataOptions = undefined
    if (flags.extractMetadata || 
        flags.metadataDates === false || 
        flags.metadataAuthors === false || 
        flags.metadataMetaTags === false || 
        flags.metadataOpengraph === false || 
        flags.metadataTwitter === false || 
        flags.extractJsonLd || 
        flags.extractMicrodata) {
      metadataOptions = {
        extractDates: flags.metadataDates !== false,
        extractAuthors: flags.metadataAuthors !== false,
        extractMetaTags: flags.metadataMetaTags !== false,
        extractOpenGraph: flags.metadataOpengraph !== false,
        extractTwitterCard: flags.metadataTwitter !== false,
        extractJsonLd: flags.extractJsonLd === true,
        extractMicrodata: flags.extractMicrodata === true
      }
    }
    
    // Parse progress options
    let progressOptions = undefined
    if (flags.progress !== undefined || 
        flags.progressUpdateInterval || 
        flags.progressBarWidth || 
        flags.progressBar === false) {
      progressOptions = {
        enabled: flags.progress !== false, 
        updateInterval: flags.progressUpdateInterval && parseInt(flags.progressUpdateInterval, 10),
        showProgressBar: flags.progressBar !== false,
        progressBarWidth: flags.progressBarWidth && parseInt(flags.progressBarWidth, 10)
      }
    }
    
    // Parse request configuration options
    let requestOptions = undefined
    if (flags.timeout || 
        flags.userAgent || 
        flags.cookies || 
        flags.proxy || 
        flags.followRedirects === false || 
        flags.maxRedirects || 
        flags.maxResponseSize || 
        flags.verifySsl === false || 
        flags.cert || 
        flags.key || 
        flags.ca) {
      requestOptions = {
        timeout: flags.timeout && parseInt(flags.timeout, 10),
        userAgent: flags.userAgent,
        followRedirects: flags.followRedirects !== false,
        maxRedirects: flags.maxRedirects && parseInt(flags.maxRedirects, 10),
        maxResponseSize: flags.maxResponseSize && parseInt(flags.maxResponseSize, 10),
        headers: {},
        tls: {}
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

    const pages = await fetchSite(url, {
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
      },
      filter: filterOptions,
      transform: {
        format: flags.format,
        prettyPrint: flags.prettyPrint === true,
        removeExcessWhitespace: flags.excessWhitespace === false,
        removeLineBreaks: flags.lineBreaks === false,
      },
      cache: cacheOptions,
      metadata: metadataOptions,
      request: requestOptions,
      progress: progressOptions
    })

    if (pages.size === 0) {
      logger.warn("No pages found")
      return
    }

    const pagesArr = [...pages.values()]

    const totalTokenCount = pagesArr.reduce(
      (acc, page) => acc + encode(page.content).length,
      0
    )

    logger.info(
      `Total token count for ${pages.size} pages: ${formatNumber(
        totalTokenCount
      )}`
    )

    if (flags.outfile) {
      const format = flags.format || (flags.outfile.endsWith(".json") ? "json" : "text")
      const output = serializePages(
        pages,
        format,
        {
          prettyPrint: flags.prettyPrint === true,
          removeExcessWhitespace: flags.excessWhitespace === false, 
          removeLineBreaks: flags.lineBreaks === false,
        }
      )
      fs.mkdirSync(path.dirname(flags.outfile), { recursive: true })
      fs.writeFileSync(flags.outfile, output, "utf8")
    } else {
      // Default to text format for console output
      const format = flags.format || "text"
      console.log(serializePages(
        pages,
        format,
        {
          prettyPrint: flags.prettyPrint === true,
          removeExcessWhitespace: flags.excessWhitespace === false, 
          removeLineBreaks: flags.lineBreaks === false,
        }
      ))
    }
  })

cli.version(version)
cli.help()
cli.parse()
