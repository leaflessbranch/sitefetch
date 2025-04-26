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