import fs from 'node:fs'
import path from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { logger } from '../logger'
import { SiteFetchError } from '../errors'
import { Page, ErrorCode } from '../types'

// Promisify zlib functions
const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/**
 * Error codes specific to resumable operations
 */
export enum ResumeErrorCode {
  CHECKPOINT_SAVE_ERROR = 'CHECKPOINT_SAVE_ERROR',
  CHECKPOINT_LOAD_ERROR = 'CHECKPOINT_LOAD_ERROR',
  CHECKPOINT_NOT_FOUND = 'CHECKPOINT_NOT_FOUND',
  CHECKPOINT_CORRUPTED = 'CHECKPOINT_CORRUPTED'
}

/**
 * Error thrown when resumable operations fail
 */
export class ResumeError extends SiteFetchError {
  constructor(message: string, public subCode: ResumeErrorCode) {
    super(message, ErrorCode.RESUME_ERROR)
    this.name = 'ResumeError'
  }
}

/**
 * Options for resumable operations
 */
export interface ResumeOptions {
  /** Enable resumable operations */
  enabled?: boolean
  /** Directory to store checkpoint files */
  checkpointDir?: string
  /** Interval between checkpoints in milliseconds */
  checkpointInterval?: number
  /** File name format for checkpoints */
  checkpointFileFormat?: string
  /** Maximum number of checkpoints to keep */
  maxCheckpoints?: number
  /** Whether to compress checkpoints */
  compress?: boolean
  /** Compression level (0-9) */
  compressionLevel?: number
  /** Custom identifier for the checkpoint */
  checkpointId?: string
}

/**
 * Default options for resumable operations
 */
const DEFAULT_RESUME_OPTIONS: ResumeOptions = {
  enabled: false,
  checkpointDir: '.sitefetch-checkpoints',
  checkpointInterval: 30000, // 30 seconds
  checkpointFileFormat: 'checkpoint-{{id}}-{{timestamp}}.json',
  maxCheckpoints: 5,
  compress: true,
  compressionLevel: 6
}

/**
 * Checkpoint data structure
 */
export interface CheckpointData {
  /** Unique identifier for the checkpoint */
  id: string
  /** Base URL being fetched */
  baseUrl: string
  /** Timestamp when the checkpoint was created */
  timestamp: number
  /** URLs that have been processed */
  processedUrls: string[]
  /** Pages that have been fetched */
  pages: { [pathname: string]: Page }
  /** URLs that failed to fetch */
  failedUrls: string[]
  /** URLs that were skipped */
  skippedUrls: string[]
  /** Current queue of URLs to process */
  pendingUrls: string[]
  /** Additional metadata */
  metadata?: Record<string, any>
}

/**
 * Class for handling resumable operations
 */
export class ResumeHandler {
  private options: ResumeOptions
  private lastCheckpoint: number = 0
  private checkpointTimer: NodeJS.Timeout | null = null
  private checkpointData: CheckpointData | null = null
  private checkpointIdPrefix: string

  /**
   * Creates a new resume handler
   * 
   * @param options Options for resumable operations
   */
  constructor(options: ResumeOptions = {}) {
    this.options = { ...DEFAULT_RESUME_OPTIONS, ...options }
    
    // Generate a unique checkpoint ID if not provided
    this.checkpointIdPrefix = this.options.checkpointId || 
      `sitefetch-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Initializes a new checkpoint for the given URL
   * 
   * @param baseUrl Base URL being fetched
   * @param metadata Additional metadata to store
   * @returns The initialized checkpoint data
   */
  async initializeCheckpoint(
    baseUrl: string, 
    metadata?: Record<string, any>
  ): Promise<CheckpointData> {
    if (!this.options.enabled) {
      logger.warn('Resumable operations are disabled, checkpoint will not be saved')
    }

    this.checkpointData = {
      id: this.checkpointIdPrefix,
      baseUrl,
      timestamp: Date.now(),
      processedUrls: [],
      pages: {},
      failedUrls: [],
      skippedUrls: [],
      pendingUrls: [baseUrl],
      metadata
    }

    // Create checkpoint directory if it doesn't exist
    if (this.options.enabled) {
      this.ensureCheckpointDirectory()
      
      // Save initial checkpoint
      await this.saveCheckpoint()
      
      // Start checkpoint timer
      this.startCheckpointTimer()
    }

    return this.checkpointData
  }

  /**
   * Loads a checkpoint for resuming operations
   * 
   * @param id Checkpoint ID to load
   * @returns The loaded checkpoint data
   */
  async loadCheckpoint(id: string): Promise<CheckpointData> {
    if (!this.options.enabled) {
      throw new ResumeError(
        'Resumable operations are disabled, cannot load checkpoint',
        ResumeErrorCode.CHECKPOINT_LOAD_ERROR
      )
    }

    // Find the latest checkpoint file for the given ID
    const checkpointFile = await this.findLatestCheckpoint(id)
    
    if (!checkpointFile) {
      throw new ResumeError(
        `No checkpoint found for ID ${id}`,
        ResumeErrorCode.CHECKPOINT_NOT_FOUND
      )
    }

    try {
      // Read the checkpoint file
      const checkpointPath = path.join(
        this.options.checkpointDir || DEFAULT_RESUME_OPTIONS.checkpointDir!,
        checkpointFile
      )
      
      const fileContent = fs.readFileSync(checkpointPath)
      
      // Decompress if needed
      let checkpointContent: string
      if (this.options.compress !== false && checkpointFile.endsWith('.gz')) {
        checkpointContent = (await gunzipAsync(fileContent)).toString('utf-8')
      } else {
        checkpointContent = fileContent.toString('utf-8')
      }
      
      // Parse the checkpoint data
      this.checkpointData = JSON.parse(checkpointContent)
      
      // Validate the checkpoint data
      this.validateCheckpointData(this.checkpointData)
      
      // Set up the checkpoint prefix for future saves
      this.checkpointIdPrefix = this.checkpointData.id
      
      // Start checkpoint timer
      this.startCheckpointTimer()
      
      logger.info(`Loaded checkpoint for ${this.checkpointData.baseUrl} with ${
        Object.keys(this.checkpointData.pages).length
      } pages`)
      
      return this.checkpointData
    } catch (error) {
      if (error instanceof ResumeError) {
        throw error
      }
      
      throw new ResumeError(
        `Failed to load checkpoint: ${error.message}`,
        ResumeErrorCode.CHECKPOINT_LOAD_ERROR
      )
    }
  }

  /**
   * Updates the checkpoint with a newly fetched page
   * 
   * @param pathname Pathname of the page
   * @param page Page data
   */
  addFetchedPage(pathname: string, page: Page): void {
    if (!this.checkpointData) {
      logger.warn('No active checkpoint, page will not be saved')
      return
    }

    // Add the page to the checkpoint data
    this.checkpointData.pages[pathname] = page
    
    // Add URL to processed URLs if not already there
    const url = page.url
    if (!this.checkpointData.processedUrls.includes(url)) {
      this.checkpointData.processedUrls.push(url)
    }
    
    // Remove from pending URLs if present
    const pendingIndex = this.checkpointData.pendingUrls.indexOf(url)
    if (pendingIndex !== -1) {
      this.checkpointData.pendingUrls.splice(pendingIndex, 1)
    }
  }

  /**
   * Updates the checkpoint with a failed URL
   * 
   * @param url URL that failed to fetch
   */
  addFailedUrl(url: string): void {
    if (!this.checkpointData) {
      logger.warn('No active checkpoint, failed URL will not be saved')
      return
    }

    // Add URL to failed URLs
    if (!this.checkpointData.failedUrls.includes(url)) {
      this.checkpointData.failedUrls.push(url)
    }
    
    // Remove from pending URLs if present
    const pendingIndex = this.checkpointData.pendingUrls.indexOf(url)
    if (pendingIndex !== -1) {
      this.checkpointData.pendingUrls.splice(pendingIndex, 1)
    }
  }

  /**
   * Updates the checkpoint with a skipped URL
   * 
   * @param url URL that was skipped
   */
  addSkippedUrl(url: string): void {
    if (!this.checkpointData) {
      logger.warn('No active checkpoint, skipped URL will not be saved')
      return
    }

    // Add URL to skipped URLs
    if (!this.checkpointData.skippedUrls.includes(url)) {
      this.checkpointData.skippedUrls.push(url)
    }
    
    // Remove from pending URLs if present
    const pendingIndex = this.checkpointData.pendingUrls.indexOf(url)
    if (pendingIndex !== -1) {
      this.checkpointData.pendingUrls.splice(pendingIndex, 1)
    }
  }

  /**
   * Adds a URL to the pending queue
   * 
   * @param url URL to add to pending queue
   */
  addPendingUrl(url: string): void {
    if (!this.checkpointData) {
      logger.warn('No active checkpoint, pending URL will not be saved')
      return
    }

    // Check if the URL is already processed, failed, or skipped
    if (
      this.checkpointData.processedUrls.includes(url) ||
      this.checkpointData.failedUrls.includes(url) ||
      this.checkpointData.skippedUrls.includes(url) ||
      this.checkpointData.pendingUrls.includes(url)
    ) {
      return
    }

    // Add URL to pending URLs
    this.checkpointData.pendingUrls.push(url)
  }

  /**
   * Updates the metadata of the checkpoint
   * 
   * @param metadata New metadata to merge with existing metadata
   */
  updateMetadata(metadata: Record<string, any>): void {
    if (!this.checkpointData) {
      logger.warn('No active checkpoint, metadata will not be updated')
      return
    }

    this.checkpointData.metadata = {
      ...this.checkpointData.metadata,
      ...metadata
    }
  }

  /**
   * Saves the current checkpoint
   * 
   * @returns Promise that resolves when the checkpoint is saved
   */
  async saveCheckpoint(): Promise<void> {
    if (!this.options.enabled || !this.checkpointData) {
      return
    }

    try {
      // Update timestamp
      this.checkpointData.timestamp = Date.now()
      
      // Serialize the checkpoint data
      const checkpointJson = JSON.stringify(this.checkpointData)
      
      // Create a filename
      const filename = this.options.checkpointFileFormat!
        .replace('{{id}}', this.checkpointData.id)
        .replace('{{timestamp}}', Date.now().toString())
      
      const compressionEnabled = this.options.compress !== false
      const filePath = path.join(
        this.options.checkpointDir!,
        `${filename}${compressionEnabled ? '.gz' : ''}`
      )
      
      // Compress if enabled
      if (compressionEnabled) {
        const compressed = await gzipAsync(Buffer.from(checkpointJson), {
          level: this.options.compressionLevel
        })
        fs.writeFileSync(filePath, compressed)
      } else {
        fs.writeFileSync(filePath, checkpointJson, 'utf-8')
      }
      
      logger.info(`Saved checkpoint to ${filePath}`)
      
      // Clean up old checkpoints if needed
      if (this.options.maxCheckpoints && this.options.maxCheckpoints > 0) {
        await this.pruneOldCheckpoints()
      }
      
      this.lastCheckpoint = Date.now()
    } catch (error) {
      logger.warn(`Failed to save checkpoint: ${error.message}`)
      throw new ResumeError(
        `Failed to save checkpoint: ${error.message}`,
        ResumeErrorCode.CHECKPOINT_SAVE_ERROR
      )
    }
  }

  /**
   * Ensures the checkpoint directory exists
   * 
   * @private
   */
  private ensureCheckpointDirectory(): void {
    const dir = this.options.checkpointDir || DEFAULT_RESUME_OPTIONS.checkpointDir!
    
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        logger.info(`Created checkpoint directory: ${dir}`)
      }
    } catch (error) {
      logger.warn(`Failed to create checkpoint directory: ${error.message}`)
      throw new ResumeError(
        `Failed to create checkpoint directory: ${error.message}`,
        ResumeErrorCode.CHECKPOINT_SAVE_ERROR
      )
    }
  }

  /**
   * Finds the latest checkpoint file for the given ID
   * 
   * @param id Checkpoint ID to find
   * @returns Filename of the latest checkpoint or undefined if not found
   * @private
   */
  private async findLatestCheckpoint(id: string): Promise<string | undefined> {
    const dir = this.options.checkpointDir || DEFAULT_RESUME_OPTIONS.checkpointDir!
    
    try {
      if (!fs.existsSync(dir)) {
        return undefined
      }
      
      // Get all checkpoint files
      const files = fs.readdirSync(dir)
      
      // Filter for files matching the ID
      const matchingFiles = files.filter(file => 
        file.includes(`checkpoint-${id}`) &&
        (file.endsWith('.json') || file.endsWith('.json.gz'))
      )
      
      if (matchingFiles.length === 0) {
        return undefined
      }
      
      // Sort by timestamp (newest first)
      matchingFiles.sort((a, b) => {
        // Extract timestamp from filename
        const getTimestamp = (filename: string) => {
          const match = filename.match(/-(\d+)\.json/)
          return match ? parseInt(match[1], 10) : 0
        }
        
        return getTimestamp(b) - getTimestamp(a)
      })
      
      return matchingFiles[0]
    } catch (error) {
      logger.warn(`Failed to find checkpoint: ${error.message}`)
      return undefined
    }
  }

  /**
   * Validates the checkpoint data structure
   * 
   * @param data Checkpoint data to validate
   * @private
   */
  private validateCheckpointData(data: CheckpointData): void {
    // Check for required fields
    if (!data.id || !data.baseUrl || !data.timestamp) {
      throw new ResumeError(
        'Checkpoint data is missing required fields',
        ResumeErrorCode.CHECKPOINT_CORRUPTED
      )
    }
    
    // Ensure arrays exist
    if (!Array.isArray(data.processedUrls)) data.processedUrls = []
    if (!Array.isArray(data.failedUrls)) data.failedUrls = []
    if (!Array.isArray(data.skippedUrls)) data.skippedUrls = []
    if (!Array.isArray(data.pendingUrls)) data.pendingUrls = []
    
    // Ensure pages object exists
    if (!data.pages || typeof data.pages !== 'object') {
      data.pages = {}
    }
  }

  /**
   * Removes old checkpoint files to keep only the most recent ones
   * 
   * @private
   */
  private async pruneOldCheckpoints(): Promise<void> {
    if (!this.checkpointData) return
    
    const dir = this.options.checkpointDir || DEFAULT_RESUME_OPTIONS.checkpointDir!
    const maxFiles = this.options.maxCheckpoints || 5
    
    try {
      // Get all checkpoint files for this ID
      const files = fs.readdirSync(dir)
      const matchingFiles = files.filter(file => 
        file.includes(`checkpoint-${this.checkpointData!.id}`) &&
        (file.endsWith('.json') || file.endsWith('.json.gz'))
      )
      
      if (matchingFiles.length <= maxFiles) {
        return
      }
      
      // Sort by timestamp (newest first)
      matchingFiles.sort((a, b) => {
        // Extract timestamp from filename
        const getTimestamp = (filename: string) => {
          const match = filename.match(/-(\d+)\.json/)
          return match ? parseInt(match[1], 10) : 0
        }
        
        return getTimestamp(b) - getTimestamp(a)
      })
      
      // Remove older files
      const filesToRemove = matchingFiles.slice(maxFiles)
      for (const file of filesToRemove) {
        const filePath = path.join(dir, file)
        fs.unlinkSync(filePath)
        logger.info(`Removed old checkpoint: ${filePath}`)
      }
    } catch (error) {
      logger.warn(`Failed to prune old checkpoints: ${error.message}`)
    }
  }

  /**
   * Starts the checkpoint timer for periodic saves
   * 
   * @private
   */
  private startCheckpointTimer(): void {
    // Clear any existing timer
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
    
    // Skip if disabled or no interval set
    if (!this.options.enabled || !this.options.checkpointInterval) {
      return
    }
    
    // Set up the timer
    this.checkpointTimer = setInterval(async () => {
      try {
        await this.saveCheckpoint()
      } catch (error) {
        logger.warn(`Auto-checkpoint failed: ${error.message}`)
      }
    }, this.options.checkpointInterval)
  }

  /**
   * Stops the checkpoint timer
   */
  stopCheckpointTimer(): void {
    if (this.checkpointTimer) {
      clearInterval(this.checkpointTimer)
      this.checkpointTimer = null
    }
  }

  /**
   * Gets the current checkpoint data
   * 
   * @returns Current checkpoint data or null if none
   */
  getCheckpointData(): CheckpointData | null {
    return this.checkpointData
  }

  /**
   * Gets the URLs that have been processed
   * 
   * @returns Array of processed URLs
   */
  getProcessedUrls(): string[] {
    return this.checkpointData?.processedUrls || []
  }

  /**
   * Gets the URLs that have failed
   * 
   * @returns Array of failed URLs
   */
  getFailedUrls(): string[] {
    return this.checkpointData?.failedUrls || []
  }

  /**
   * Gets the URLs that have been skipped
   * 
   * @returns Array of skipped URLs
   */
  getSkippedUrls(): string[] {
    return this.checkpointData?.skippedUrls || []
  }

  /**
   * Gets the URLs that are pending
   * 
   * @returns Array of pending URLs
   */
  getPendingUrls(): string[] {
    return this.checkpointData?.pendingUrls || []
  }

  /**
   * Checks if a URL has been processed
   * 
   * @param url URL to check
   * @returns Whether the URL has been processed
   */
  isUrlProcessed(url: string): boolean {
    return this.checkpointData?.processedUrls.includes(url) || false
  }

  /**
   * Checks if a URL has failed
   * 
   * @param url URL to check
   * @returns Whether the URL has failed
   */
  isUrlFailed(url: string): boolean {
    return this.checkpointData?.failedUrls.includes(url) || false
  }

  /**
   * Checks if a URL has been skipped
   * 
   * @param url URL to check
   * @returns Whether the URL has been skipped
   */
  isUrlSkipped(url: string): boolean {
    return this.checkpointData?.skippedUrls.includes(url) || false
  }

  /**
   * Checks if a URL is pending
   * 
   * @param url URL to check
   * @returns Whether the URL is pending
   */
  isUrlPending(url: string): boolean {
    return this.checkpointData?.pendingUrls.includes(url) || false
  }

  /**
   * Completes the checkpoint operations and saves final state
   */
  async complete(): Promise<void> {
    // Save one last checkpoint
    if (this.options.enabled && this.checkpointData) {
      await this.saveCheckpoint()
    }
    
    // Stop the checkpoint timer
    this.stopCheckpointTimer()
    
    logger.info('Checkpoint operations completed')
  }

  /**
   * Updates the options for the handler
   * 
   * @param options New options to merge with existing options
   */
  updateOptions(options: Partial<ResumeOptions>): void {
    this.options = { ...this.options, ...options }
    
    // Restart the timer if the interval changed
    if (options.checkpointInterval && this.checkpointTimer) {
      this.startCheckpointTimer()
    }
  }
}

/**
 * Creates a resume handler with the specified options
 * 
 * @param options Resume options
 * @returns Resume handler instance
 */
export function createResumeHandler(options?: ResumeOptions): ResumeHandler {
  return new ResumeHandler(options)
}
