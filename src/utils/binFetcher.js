/**
 * Utility for fetching bin inventory data for finished goods.
 * Handles large datasets by chunking FG names and proper pagination.
 */

/**
 * Chunks an array into smaller arrays of specified size
 * @param {Array} array - Array to chunk
 * @param {number} size - Size of each chunk
 * @returns {Array} Array of chunks
 */
function chunkArray(array, size) {
    const chunks = []
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size))
    }
    return chunks
}

/**
 * Normalizes a string for consistent key matching
 * @param {string} s - String to normalize
 * @returns {string} Normalized string
 */
const norm = s => String(s ?? '').trim().toLowerCase()

/**
 * Fetches bins for a single chunk of FG names with proper pagination
 * @param {Object} supabase - Supabase client
 * @param {Array<string>} fgNames - Array of finished good names
 * @param {number} pageSize - Number of rows to fetch per page
 * @returns {Promise<Array>} Array of bin records
 */
async function fetchBinsForChunk(supabase, fgNames, pageSize = 1000) {
    const allBins = []
    let page = 0
    let hasMore = true

    while (hasMore) {
        const from = page * pageSize
        const to = from + pageSize - 1

        const { data, error } = await supabase
            .from('v_bin_inventory')
            .select('finished_good_name, bin_code, produced_at')
            .in('finished_good_name', fgNames)
            .range(from, to)

        if (error) {
            console.error(`fetchBinsForChunk error (page ${page}):`, error)
            throw error
        }

        if (data && data.length > 0) {
            allBins.push(...data)
            // If we got less than pageSize, we've reached the end
            hasMore = data.length === pageSize
            page++
        } else {
            hasMore = false
        }
    }

    return allBins
}

/**
 * Fetches bins for multiple finished goods, handling large datasets
 * @param {Object} supabase - Supabase client
 * @param {Array<string>} fgNames - Array of finished good names
 * @param {Object} options - Configuration options
 * @param {number} options.chunkSize - Number of FG names per chunk (default: 50)
 * @param {number} options.pageSize - Number of rows per page (default: 1000)
 * @returns {Promise<Object>} Object with FG names as keys (normalized) and bin arrays as values
 */
export async function fetchBinsForFgNames(supabase, fgNames, options = {}) {
    const { chunkSize = 50, pageSize = 1000 } = options

    if (!fgNames || fgNames.length === 0) {
        return {}
    }

    // Remove empty/null values and ensure unique
    const cleanedNames = Array.from(new Set(
        fgNames
            .map(n => String(n || '').trim())
            .filter(Boolean)
    ))

    if (cleanedNames.length === 0) {
        return {}
    }

    console.debug(`fetchBinsForFgNames: Processing ${cleanedNames.length} unique FG names in chunks of ${chunkSize}`)

    // Split into chunks to avoid URL length limits
    const chunks = chunkArray(cleanedNames, chunkSize)
    console.debug(`fetchBinsForFgNames: Split into ${chunks.length} chunks`)

    try {
        // Fetch all chunks in parallel
        const chunkResults = await Promise.all(
            chunks.map((chunk, idx) => {
                console.debug(`fetchBinsForFgNames: Fetching chunk ${idx + 1}/${chunks.length} (${chunk.length} items)`)
                return fetchBinsForChunk(supabase, chunk, pageSize)
            })
        )

        // Flatten all results
        const allBins = chunkResults.flat()
        console.debug(`fetchBinsForFgNames: Fetched ${allBins.length} total bin records`)

        // Group by finished good name (normalized)
        const results = {}
        const wantedNorms = new Set(cleanedNames.map(n => norm(n)))

        allBins.forEach(r => {
            const rawName = r.finished_good_name
            const key = norm(rawName)

            // Only include if it's in our wanted list
            if (!wantedNorms.has(key)) return

            if (!results[key]) {
                results[key] = {}
            }

            const bin = r.bin_code || '—'
            const prod = r.produced_at ? Date.parse(r.produced_at) : Number.POSITIVE_INFINITY

            if (!results[key][bin]) {
                results[key][bin] = {
                    qty: 0,
                    oldest: Number.POSITIVE_INFINITY
                }
            }

            results[key][bin].qty += 1
            if (prod < results[key][bin].oldest) {
                results[key][bin].oldest = prod
            }
        })

        // Convert to array format
        const formatted = {}
        Object.entries(results).forEach(([fgKey, bins]) => {
            const arr = Object.entries(bins).map(([bin_code, v]) => ({
                bin_code,
                qty: v.qty,
                oldest_produced_at: isFinite(v.oldest) ? new Date(v.oldest).toISOString() : null
            }))

            // Sort by oldest produced_at, then by bin_code
            arr.sort((a, b) => {
                const ta = a.oldest_produced_at ? Date.parse(a.oldest_produced_at) : Number.POSITIVE_INFINITY
                const tb = b.oldest_produced_at ? Date.parse(b.oldest_produced_at) : Number.POSITIVE_INFINITY
                if (ta !== tb) return ta - tb
                return String(a.bin_code).localeCompare(String(b.bin_code))
            })

            formatted[fgKey] = arr
        })

        console.debug(`fetchBinsForFgNames: Grouped into ${Object.keys(formatted).length} unique FGs`)
        return formatted

    } catch (error) {
        console.error('fetchBinsForFgNames: Fatal error', error)
        throw error
    }
}

/**
 * Simpler version for print/export where we just need bin_code: qty mapping
 * @param {Object} supabase - Supabase client
 * @param {Array<string>} fgNames - Array of finished good names
 * @param {Object} options - Configuration options
 * @returns {Promise<Object>} Object with FG names as keys (normalized) and array of {bin_code, qty} as values
 */
export async function fetchBinsForPrint(supabase, fgNames, options = {}) {
    const bins = await fetchBinsForFgNames(supabase, fgNames, options)

    // Simplify to just bin_code and qty (without oldest_produced_at)
    const simplified = {}
    Object.entries(bins).forEach(([fgKey, arr]) => {
        simplified[fgKey] = arr.map(({ bin_code, qty }) => ({ bin_code, qty }))
    })

    return simplified
}
