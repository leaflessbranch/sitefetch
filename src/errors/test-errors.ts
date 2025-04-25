/**
 * This is a simple test script to demonstrate the error handling functionality.
 * In a real project, this would be a proper test suite using Jest or similar.
 */

import { 
  FetchError, 
  ParseError, 
  TimeoutError, 
  withRetry, 
  fetchWithRetry
} from './index'

// Test custom error classes
const fetchError = new FetchError('https://example.com', 404, 'Not Found')
console.log(fetchError.toLogString())

const parseError = new ParseError('https://example.com')
console.log(parseError.toLogString())

const timeoutError = new TimeoutError('https://example.com', 5000)
console.log(timeoutError.toLogString())

// Test retry functionality
async function testRetry() {
  let attempts = 0

  try {
    await withRetry(
      async () => {
        attempts++
        if (attempts < 3) {
          throw new Error(`Failure attempt ${attempts}`)
        }
        return 'success'
      },
      {
        retries: 3,
        retryDelay: 100,
      }
    )
    console.log(`Retry succeeded after ${attempts} attempts`)
  } catch (error) {
    console.error(`Retry failed: ${error.message}`)
  }

  // Test retry that fails all attempts
  attempts = 0
  try {
    await withRetry(
      async () => {
        attempts++
        throw new Error(`Always fails (attempt ${attempts})`)
      },
      {
        retries: 2,
        retryDelay: 100,
      }
    )
  } catch (error) {
    console.log(`Expected failure after ${attempts} attempts: ${error.message}`)
  }
}

// Uncomment to run the test
// testRetry().catch(console.error)

// Example of how to use fetchWithRetry in real code:
async function exampleUsage() {
  try {
    // Fetch with a timeout and retry
    const response = await fetchWithRetry(
      'https://example.com',
      {
        timeout: 5000,
        headers: {
          'User-Agent': 'SiteFetch'
        }
      },
      {
        retries: 3,
        retryDelay: 1000
      }
    )
    
    console.log(`Fetch succeeded with status ${response.status}`)
    const text = await response.text()
    console.log(`Response length: ${text.length} characters`)
  } catch (error) {
    console.error(`Fetch failed: ${error.message}`)
  }
}

// Uncomment to run the example
// exampleUsage().catch(console.error)
