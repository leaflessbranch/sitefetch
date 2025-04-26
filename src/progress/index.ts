import { EventEmitter } from 'node:events'
import { Page } from '../types'
import { logger } from '../logger'

/**
 * Event types emitted by the progress tracker
 */
export enum ProgressEvent {
  START = 'start',
  PAGE_FETCHED = 'page-fetched',
  PAGE_FAILED = 'page-failed',
  PAGE_SKIPPED = 'page-skipped',
  PROGRESS = 'progress',
  COMPLETE = 'complete',
  ERROR = 'error',
}

/**
 * Options for progress tracking
 */
export interface ProgressOptions {
  /** Enable progress tracking */
  enabled?: boolean
  /** Update interval in milliseconds */
  updateInterval?: number
  /** Show progress bar in CLI */
  showProgressBar?: boolean
  /** Width of the progress bar in characters */
  progressBarWidth?: number
  /** Progress bar character for completed segments */
  progressBarChar?: string
  /** Progress bar character for incomplete segments */
  incompleteChar?: string
  /** Show detailed statistics */
  showStats?: boolean
}

/**
 * Default progress options
 */
const DEFAULT_PROGRESS_OPTIONS: ProgressOptions = {
  enabled: true,
  updateInterval: 1000,
  showProgressBar: true,
  progressBarWidth: 30,
  progressBarChar: '█',
  incompleteChar: '░',
  showStats: true,
}

/**
 * Progress statistics data
 */
export interface ProgressStats {
  /** Total pages to process */
  total: number
  /** Pages successfully processed */
  completed: number
  /** Pages that failed */
  failed: number
  /** Pages skipped due to filtering */
  skipped: number
  /** Pages currently being processed */
  inProgress: number
  /** Elapsed time in milliseconds */
  elapsedTimeMs: number
  /** Pages per second */
  pagesPerSecond: number
  /** Estimated time remaining in milliseconds */
  estimatedTimeRemainingMs?: number
  /** Percentage complete (0-100) */
  percentComplete: number
}

/**
 * Event data for page events
 */
export interface PageEventData {
  /** URL of the page */
  url: string
  /** Page object (for successful fetches) */
  page?: Page
  /** Error object (for failed fetches) */
  error?: Error
  /** Time taken to fetch the page in milliseconds */
  timeMs?: number
  /** Timestamp of the event */
  timestamp: number
}

/**
 * Progress tracker for monitoring fetch operations
 */
export class ProgressTracker extends EventEmitter {
  private options: ProgressOptions
  private stats: ProgressStats
  private startTime: number = 0
  private lastUpdateTime: number = 0
  private updateTimer: NodeJS.Timeout | null = null
  private isActive: boolean = false
  private recentPages: Array<{ url: string, isSuccess: boolean, timestamp: number }> = []
  private maxRecentPages: number = 100

  /**
   * Creates a new progress tracker
   * 
   * @param options Progress tracking options
   */
  constructor(options: ProgressOptions = {}) {
    super()
    this.options = { ...DEFAULT_PROGRESS_OPTIONS, ...options }

    // Initialize statistics
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      inProgress: 0,
      elapsedTimeMs: 0,
      pagesPerSecond: 0,
      percentComplete: 0,
    }
  }

  /**
   * Start tracking progress
   * 
   * @param total Estimated total number of pages to process
   */
  start(total: number = 0): void {
    if (!this.options.enabled) return

    this.startTime = Date.now()
    this.lastUpdateTime = this.startTime
    this.isActive = true
    this.stats.total = total
    this.recentPages = []

    // Emit start event
    this.emit(ProgressEvent.START, { 
      timestamp: this.startTime,
      total
    })

    // Schedule periodic updates
    if (this.options.updateInterval && this.options.updateInterval > 0) {
      this.updateTimer = setInterval(() => {
        this.updateProgress()
      }, this.options.updateInterval)
    }

    // Log start
    if (this.options.showProgressBar) {
      this.renderProgressBar()
    }
  }

  /**
   * Notify that a page was successfully fetched
   * 
   * @param url URL of the fetched page
   * @param page Page object
   * @param timeMs Time taken to fetch the page in milliseconds
   */
  pageFetched(url: string, page: Page, timeMs?: number): void {
    if (!this.options.enabled || !this.isActive) return

    this.stats.completed++
    this.stats.inProgress = Math.max(0, this.stats.inProgress - 1)
    this.addRecentPage(url, true)

    // Emit page-fetched event
    this.emit(ProgressEvent.PAGE_FETCHED, {
      url,
      page,
      timeMs,
      timestamp: Date.now()
    } as PageEventData)

    // Update progress
    this.updateProgress()
  }

  /**
   * Notify that a page fetch failed
   * 
   * @param url URL of the failed page
   * @param error Error object
   */
  pageFailed(url: string, error: Error): void {
    if (!this.options.enabled || !this.isActive) return

    this.stats.failed++
    this.stats.inProgress = Math.max(0, this.stats.inProgress - 1)
    this.addRecentPage(url, false)

    // Emit page-failed event
    this.emit(ProgressEvent.PAGE_FAILED, {
      url,
      error,
      timestamp: Date.now()
    } as PageEventData)

    // Update progress
    this.updateProgress()
  }

  /**
   * Notify that a page was skipped
   * 
   * @param url URL of the skipped page
   * @param reason Reason for skipping
   */
  pageSkipped(url: string, reason?: string): void {
    if (!this.options.enabled || !this.isActive) return

    this.stats.skipped++

    // Emit page-skipped event
    this.emit(ProgressEvent.PAGE_SKIPPED, {
      url,
      error: reason ? new Error(reason) : undefined,
      timestamp: Date.now()
    } as PageEventData)

    // Update progress
    this.updateProgress()
  }

  /**
   * Notify that a page fetch is starting
   * 
   * @param url URL of the page being fetched
   */
  pageFetching(url: string): void {
    if (!this.options.enabled || !this.isActive) return

    this.stats.inProgress++

    // No need for a specific event here, but could be added if needed
    this.updateProgress()
  }

  /**
   * Add a page to the recent pages list
   * 
   * @param url URL of the page
   * @param isSuccess Whether the fetch was successful
   */
  private addRecentPage(url: string, isSuccess: boolean): void {
    this.recentPages.push({
      url,
      isSuccess,
      timestamp: Date.now()
    })

    // Keep only the most recent pages
    if (this.recentPages.length > this.maxRecentPages) {
      this.recentPages.shift()
    }
  }

  /**
   * Update progress statistics
   */
  private updateProgress(): void {
    if (!this.options.enabled || !this.isActive) return

    const now = Date.now()
    this.stats.elapsedTimeMs = now - this.startTime

    // Calculate pages per second
    if (this.stats.elapsedTimeMs > 0) {
      const processedPages = this.stats.completed + this.stats.failed
      this.stats.pagesPerSecond = (processedPages * 1000) / this.stats.elapsedTimeMs
    }

    // Calculate percent complete
    if (this.stats.total > 0) {
      const processedPages = this.stats.completed + this.stats.failed + this.stats.skipped
      this.stats.percentComplete = Math.min(100, (processedPages * 100) / this.stats.total)

      // Estimate time remaining
      if (this.stats.pagesPerSecond > 0) {
        const remainingPages = this.stats.total - processedPages
        this.stats.estimatedTimeRemainingMs = (remainingPages / this.stats.pagesPerSecond) * 1000
      }
    } else {
      this.stats.percentComplete = 0
    }

    // Emit progress event if enough time has passed
    if (now - this.lastUpdateTime >= this.options.updateInterval) {
      this.lastUpdateTime = now
      this.emit(ProgressEvent.PROGRESS, this.stats)

      // Render progress bar if enabled
      if (this.options.showProgressBar) {
        this.renderProgressBar()
      }
    }
  }

  /**
   * Render a progress bar to the console
   */
  private renderProgressBar(): void {
    if (!this.options.enabled || !this.options.showProgressBar) return

    const barWidth = this.options.progressBarWidth || 30
    const percentComplete = this.stats.percentComplete
    const filledWidth = Math.round((percentComplete / 100) * barWidth)
    const emptyWidth = barWidth - filledWidth

    const bar = 
      this.options.progressBarChar.repeat(filledWidth) + 
      this.options.incompleteChar.repeat(emptyWidth)
    
    // Format statistics
    const processedPages = this.stats.completed + this.stats.failed + this.stats.skipped
    const totalDisplay = this.stats.total > 0 ? this.stats.total : '?'
    const speedDisplay = this.stats.pagesPerSecond.toFixed(1)
    
    let timeDisplay = ''
    if (this.stats.estimatedTimeRemainingMs) {
      const seconds = Math.round(this.stats.estimatedTimeRemainingMs / 1000)
      if (seconds < 60) {
        timeDisplay = `${seconds}s`
      } else if (seconds < 3600) {
        timeDisplay = `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      } else {
        timeDisplay = `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
      }
      timeDisplay = ` ETA: ${timeDisplay}`
    }

    // Clear line and render progress bar
    process.stdout.write('\r\x1b[K') // Clear the line
    process.stdout.write(
      `[${bar}] ${percentComplete.toFixed(1)}% ` +
      `(${processedPages}/${totalDisplay}, ${speedDisplay} p/s` +
      `${timeDisplay}, ` +
      `${this.stats.completed} ok, ${this.stats.failed} err)`
    )

    // Add spinner if there are in-progress requests
    if (this.stats.inProgress > 0) {
      const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
      const spinnerIdx = Math.floor((Date.now() / 100) % spinnerChars.length)
      process.stdout.write(` ${spinnerChars[spinnerIdx]} ${this.stats.inProgress} in progress`)
    }
  }

  /**
   * Complete the progress tracking
   */
  complete(): void {
    if (!this.options.enabled || !this.isActive) return

    // Stop the update timer
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }

    // Final update
    this.updateProgress()

    // Emit complete event
    this.emit(ProgressEvent.COMPLETE, this.stats)

    this.isActive = false

    // Final render of progress
    if (this.options.showProgressBar) {
      this.renderProgressBar()
      process.stdout.write('\n') // Move to next line
    }

    // Log completion
    const totalTime = Math.round(this.stats.elapsedTimeMs / 1000)
    const processedPages = this.stats.completed + this.stats.failed + this.stats.skipped
    logger.info(
      `Completed fetching ${processedPages} pages ` +
      `(${this.stats.completed} ok, ${this.stats.failed} failed, ${this.stats.skipped} skipped) ` +
      `in ${totalTime}s`
    )
  }

  /**
   * Reset the progress tracker
   */
  reset(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }

    this.isActive = false
    this.startTime = 0
    this.lastUpdateTime = 0
    this.recentPages = []

    // Reset statistics
    this.stats = {
      total: 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      inProgress: 0,
      elapsedTimeMs: 0,
      pagesPerSecond: 0,
      percentComplete: 0,
    }
  }

  /**
   * Get current progress statistics
   * 
   * @returns Progress statistics
   */
  getStats(): ProgressStats {
    return { ...this.stats }
  }

  /**
   * Get recent pages history
   * 
   * @returns Array of recent page fetch results
   */
  getRecentPages(): Array<{ url: string, isSuccess: boolean, timestamp: number }> {
    return [...this.recentPages]
  }
}

/**
 * Create a progress tracker with the specified options
 * 
 * @param options Progress tracking options
 * @returns Progress tracker instance
 */
export function createProgressTracker(options?: ProgressOptions): ProgressTracker {
  return new ProgressTracker(options)
}
