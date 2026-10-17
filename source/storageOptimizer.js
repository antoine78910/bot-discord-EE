/**
 * Storage Optimizer - Keeps Railway volume under 5GB limit
 * 
 * Strategies:
 * - Compress knowledge base files with gzip
 * - Deduplicate similar Q&A pairs
 * - Limit knowledge base to most relevant messages
 * - Monitor storage usage and alert
 * - Automatic cleanup when threshold reached
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// === Configuration ===
const STORAGE_WARNING_THRESHOLD = 0.75; // Warn at 75%
const STORAGE_CRITICAL_THRESHOLD = 0.85; // Cleanup at 85%
const MAX_KNOWLEDGE_BASE_SIZE_MB = 50; // Max 50MB for knowledge base
const MAX_QA_PAIRS = 5000; // Limit to 5000 most relevant Q&A pairs
const DEDUPLICATION_SIMILARITY = 0.85; // 85% similarity = duplicate

/**
 * Get storage usage for a directory in bytes
 */
async function getDirectorySize(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    
    let totalSize = 0;
    
    async function traverse(currentPath) {
        const stats = await fs.promises.stat(currentPath);
        
        if (stats.isFile()) {
            totalSize += stats.size;
        } else if (stats.isDirectory()) {
            const items = await fs.promises.readdir(currentPath);
            await Promise.all(items.map(item => traverse(path.join(currentPath, item))));
        }
    }
    
    await traverse(dirPath);
    return totalSize;
}

/**
 * Format bytes to human-readable size
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Check storage usage and return status
 */
async function checkStorageUsage(volumePath = '/data/content-files', volumeSize = 5 * 1024 * 1024 * 1024) {
    const used = await getDirectorySize(volumePath);
    const percentage = used / volumeSize;
    
    const status = {
        used,
        total: volumeSize,
        percentage,
        formatted: {
            used: formatBytes(used),
            total: formatBytes(volumeSize),
            percentage: Math.round(percentage * 100) + '%'
        },
        level: percentage >= STORAGE_CRITICAL_THRESHOLD ? 'critical' :
               percentage >= STORAGE_WARNING_THRESHOLD ? 'warning' : 'ok'
    };
    
    return status;
}

/**
 * Compress a file with gzip
 */
async function compressFile(filePath) {
    if (!fs.existsSync(filePath)) return false;
    
    const content = await fs.promises.readFile(filePath);
    const compressed = await gzip(content);
    
    // Only keep compressed if it's smaller
    if (compressed.length < content.length) {
        await fs.promises.writeFile(filePath + '.gz', compressed);
        await fs.promises.unlink(filePath);
        return true;
    }
    
    return false;
}

/**
 * Decompress a gzipped file
 */
async function decompressFile(filePath) {
    if (!fs.existsSync(filePath + '.gz')) return null;
    
    const compressed = await fs.promises.readFile(filePath + '.gz');
    const content = await gunzip(compressed);
    
    return content.toString('utf8');
}

/**
 * Read file (handles both compressed and uncompressed)
 */
async function readOptimizedFile(filePath) {
    // Try compressed first
    if (fs.existsSync(filePath + '.gz')) {
        return await decompressFile(filePath);
    }
    
    // Fall back to uncompressed
    if (fs.existsSync(filePath)) {
        return await fs.promises.readFile(filePath, 'utf8');
    }
    
    return null;
}

/**
 * Write file with optional compression
 */
async function writeOptimizedFile(filePath, content, compress = true) {
    // Write uncompressed first
    await fs.promises.writeFile(filePath, content, 'utf8');
    
    // Try to compress if enabled
    if (compress) {
        const compressed = await compressFile(filePath);
        if (compressed) {
            console.log(`[STORAGE] Compressed ${path.basename(filePath)} (saved ${formatBytes(content.length - (await fs.promises.stat(filePath + '.gz')).size)})`);
        }
    }
}

/**
 * Calculate similarity between two strings (Jaccard similarity)
 */
function calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.toLowerCase().split(/\s+/));
    const words2 = new Set(str2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

/**
 * Deduplicate Q&A pairs by removing similar entries
 */
function deduplicateQAPairs(pairs) {
    const unique = [];
    const seen = new Set();
    
    for (const pair of pairs) {
        const key = pair.question.toLowerCase().trim();
        
        // Skip if exact duplicate
        if (seen.has(key)) continue;
        
        // Check for similar questions
        let isDuplicate = false;
        for (const existing of unique) {
            const similarity = calculateSimilarity(pair.question, existing.question);
            if (similarity >= DEDUPLICATION_SIMILARITY) {
                isDuplicate = true;
                // Keep the pair with better metadata (more context)
                if (pair.context && pair.context.length > (existing.context?.length || 0)) {
                    // Replace with better version
                    const index = unique.indexOf(existing);
                    unique[index] = pair;
                }
                break;
            }
        }
        
        if (!isDuplicate) {
            unique.push(pair);
            seen.add(key);
        }
    }
    
    console.log(`[STORAGE] Deduplicated ${pairs.length} → ${unique.length} Q&A pairs (removed ${pairs.length - unique.length} duplicates)`);
    return unique;
}

/**
 * Optimize knowledge base by deduplication and size limiting
 */
async function optimizeKnowledgeBase(knowledgePath, metaPath) {
    try {
        const content = await readOptimizedFile(knowledgePath);
        if (!content) return;
        
        const metaContent = await readOptimizedFile(metaPath);
        const meta = metaContent ? JSON.parse(metaContent) : {};
        
        // Parse Q&A pairs from markdown
        const pairs = [];
        const sections = content.split(/\n## Q: /).slice(1);
        
        for (const section of sections) {
            const [question, ...answerParts] = section.split('\n**A:** ');
            if (answerParts.length === 0) continue;
            
            const answer = answerParts.join('\n**A:** ').split('\n---')[0].trim();
            const contextMatch = section.match(/\*Context: (.*?)\*/);
            const context = contextMatch ? contextMatch[1] : '';
            
            pairs.push({ question: question.trim(), answer, context });
        }
        
        console.log(`[STORAGE] Found ${pairs.length} Q&A pairs in knowledge base`);
        
        // Deduplicate
        let optimized = deduplicateQAPairs(pairs);
        
        // Limit to most recent if still too many
        if (optimized.length > MAX_QA_PAIRS) {
            console.log(`[STORAGE] Limiting to ${MAX_QA_PAIRS} most recent Q&A pairs`);
            optimized = optimized.slice(-MAX_QA_PAIRS);
        }
        
        // Rebuild knowledge base
        let newContent = '# Knowledge Base - EE Support\n\n';
        newContent += `Last optimized: ${new Date().toISOString()}\n`;
        newContent += `Total Q&A pairs: ${optimized.length}\n\n`;
        
        for (const pair of optimized) {
            newContent += `## Q: ${pair.question}\n**A:** ${pair.answer}\n`;
            if (pair.context) {
                newContent += `*Context: ${pair.context}*\n`;
            }
            newContent += '---\n\n';
        }
        
        // Update metadata
        meta.lastOptimized = Date.now();
        meta.totalPairs = optimized.length;
        meta.originalPairs = pairs.length;
        
        // Write optimized versions with compression
        await writeOptimizedFile(knowledgePath, newContent, true);
        await writeOptimizedFile(metaPath, JSON.stringify(meta, null, 2), true);
        
        console.log(`[STORAGE] Optimized knowledge base: ${pairs.length} → ${optimized.length} pairs`);
        
    } catch (error) {
        console.error('[STORAGE] Failed to optimize knowledge base:', error);
    }
}

/**
 * Clean up old content files
 */
async function cleanupOldContentFiles(contentFilesDir, maxAgeDays = 7) {
    if (!fs.existsSync(contentFilesDir)) return 0;
    
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleanedCount = 0;
    let freedSpace = 0;
    
    const entries = await fs.promises.readdir(contentFilesDir, { withFileTypes: true });
    
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        
        const dirPath = path.join(contentFilesDir, entry.name);
        const stats = await fs.promises.stat(dirPath);
        
        if (now - stats.mtimeMs > maxAgeMs) {
            const size = await getDirectorySize(dirPath);
            await fs.promises.rm(dirPath, { recursive: true, force: true });
            cleanedCount++;
            freedSpace += size;
        }
    }
    
    if (cleanedCount > 0) {
        console.log(`[STORAGE] Cleaned up ${cleanedCount} old content folders (freed ${formatBytes(freedSpace)})`);
    }
    
    return freedSpace;
}

/**
 * Monitor storage and trigger cleanup if needed
 */
async function monitorAndCleanup(volumePath, volumeSize, dataDir, contentFilesDir) {
    const status = await checkStorageUsage(volumePath, volumeSize);
    
    console.log(`[STORAGE] Usage: ${status.formatted.used} / ${status.formatted.total} (${status.formatted.percentage})`);
    
    if (status.level === 'warning') {
        console.warn('[STORAGE] ⚠️  Warning: Storage usage above 75%');
    }
    
    if (status.level === 'critical') {
        console.error('[STORAGE] 🚨 Critical: Storage usage above 85% - Starting cleanup...');
        
        // Cleanup old content files (reduce from 14 days to 7 days)
        await cleanupOldContentFiles(contentFilesDir, 7);
        
        // Optimize knowledge base
        const knowledgePath = path.join(dataDir, 'server-knowledge.md');
        const metaPath = path.join(dataDir, 'server-knowledge.meta.json');
        await optimizeKnowledgeBase(knowledgePath, metaPath);
        
        // Check again
        const newStatus = await checkStorageUsage(volumePath, volumeSize);
        console.log(`[STORAGE] After cleanup: ${newStatus.formatted.used} / ${newStatus.formatted.total} (${newStatus.formatted.percentage})`);
    }
}

/**
 * Initialize storage monitoring
 */
function startStorageMonitoring(volumePath, volumeSize, dataDir, contentFilesDir) {
    // Check on startup
    monitorAndCleanup(volumePath, volumeSize, dataDir, contentFilesDir)
        .catch(err => console.error('[STORAGE] Monitoring failed:', err));
    
    // Check every 6 hours
    setInterval(() => {
        monitorAndCleanup(volumePath, volumeSize, dataDir, contentFilesDir)
            .catch(err => console.error('[STORAGE] Monitoring failed:', err));
    }, 6 * 60 * 60 * 1000).unref();
}

module.exports = {
    checkStorageUsage,
    formatBytes,
    compressFile,
    decompressFile,
    readOptimizedFile,
    writeOptimizedFile,
    deduplicateQAPairs,
    optimizeKnowledgeBase,
    cleanupOldContentFiles,
    monitorAndCleanup,
    startStorageMonitoring,
    getDirectorySize
};
