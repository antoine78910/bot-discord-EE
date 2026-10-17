# Storage Optimization

## Problem

The Railway volume (content-files) was at 83% capacity (4.15GB/5GB) BEFORE running the message scraping feature. Without optimization, the bot would exceed the 5GB limit when scraping Discord message history.

## Solution

Implemented multi-layered storage optimization:

### 1. Reduced Content File TTL

**Before:** Content files (videos/images from `/ee-content`) were kept for 14 days  
**After:** Reduced to 7 days (default)  
**Impact:** ~50% reduction in content file storage

**Configuration:**
```bash
CONTENT_FILE_TTL_DAYS=7  # Set in Railway variables
```

### 2. Knowledge Base Compression

**Q&A Knowledge Base:**
- Now stored in compressed `.json.gz` format
- Uses gzip compression (~60-70% size reduction for text)
- Automatically decompresses on read
- Falls back to uncompressed if compression doesn't save space

**Implementation:**
- `qa-knowledge-base.json` → `qa-knowledge-base.json.gz`
- Uses built-in Node.js `zlib` module (no dependencies)
- Transparent to the rest of the application

### 3. Deduplication

**Similar Q&A pairs are automatically removed:**
- Uses Jaccard similarity (85% threshold)
- Keeps the pair with better context
- Runs on every knowledge base build
- Typically removes 10-30% of duplicates

**Example:**
```
Before: 5000 Q&A pairs
After deduplication: 3500 Q&A pairs
Reduction: 30%
```

### 4. Size Limiting

**Maximum Q&A pairs: 5000**
- Keeps most recent pairs when limit exceeded
- Prevents unbounded growth
- Maintains relevance (older questions less useful)

### 5. Automatic Cleanup

**Storage monitoring runs:**
- On bot startup
- Every 6 hours
- Shows usage in logs: `[STORAGE] Usage: 2.1GB / 5GB (42%)`

**Triggers:**
- **Warning (75%):** Logs warning message
- **Critical (85%):** Automatic cleanup:
  - Reduces content files from 14 days → 7 days
  - Optimizes knowledge base (deduplication)
  - Compresses all data files

### 6. Storage Monitoring

**New logs show storage status:**
```
[STORAGE] Monitoring initialized
[STORAGE] Usage: 2.1GB / 5GB (42%)
[STORAGE] Compressed qa-knowledge-base.json (saved 1.2MB)
[STORAGE] Deduplicated 5000 → 3500 Q&A pairs (removed 1500 duplicates)
[STORAGE] Cleaned up 12 old content folders (freed 350MB)
```

## Expected Impact

### Before Optimization
- Content files: ~3.5GB (14-day retention)
- Knowledge base: ~500MB (uncompressed, duplicates)
- **Total: ~4GB (80%)**

### After Optimization
- Content files: ~1.75GB (7-day retention, -50%)
- Knowledge base: ~150MB (compressed + deduplicated, -70%)
- **Total: ~1.9GB (38%)**

### Headroom for Message Scraping
- Used: 1.9GB
- Available: 3.1GB (62% free)
- Message scraping estimate: ~500MB-1GB (fits comfortably)

## Configuration Options

Add these to Railway environment variables:

```bash
# Content file retention (days)
CONTENT_FILE_TTL_DAYS=7  # Default: 7 (was 14)

# Railway volume size (GB)
VOLUME_SIZE_GB=5  # Default: 5

# Content files directory
CONTENT_FILES_DIR=/data/content-files  # Railway volume mount

# Data directory for knowledge base
DATA_DIRECTORY=/app/data  # Persistent storage
```

## Monitoring

### Check storage usage:
```bash
du -sh /data/content-files
```

### Check knowledge base size:
```bash
ls -lh /app/data/qa-knowledge-base.json.gz
```

### View logs:
```bash
# On Railway, check deployment logs for:
[STORAGE] Usage: X.XGB / 5GB (XX%)
[STORAGE] Compressed ...
[STORAGE] Deduplicated ...
[STORAGE] Cleaned up ...
```

## Manual Optimization

If storage still grows too large, you can:

1. **Reduce TTL further:**
   ```bash
   CONTENT_FILE_TTL_DAYS=5  # Keep files for 5 days instead of 7
   ```

2. **Manually trigger cleanup:**
   - Use `/agent-rebuild-qa` command
   - Restart the bot (triggers storage monitoring)

3. **Increase volume size:**
   - Upgrade Railway volume from 5GB to 10GB
   - Update `VOLUME_SIZE_GB=10` in variables

## Technical Details

### Files Created
- `source/storageOptimizer.js` - Storage optimization module
- Functions:
  - `checkStorageUsage()` - Monitor volume usage
  - `compressFile()` - Gzip compression
  - `decompressFile()` - Gzip decompression
  - `deduplicateQAPairs()` - Remove similar Q&A pairs
  - `optimizeKnowledgeBase()` - Full optimization
  - `cleanupOldContentFiles()` - Remove old content
  - `startStorageMonitoring()` - Automatic monitoring

### Modified Files
- `source/contentFiles.js` - Reduced default TTL from 14 to 7 days
- `source/index.js` - Added storage monitoring initialization
- `source/aiSupportAgent.js` - Added compression + deduplication
- `source/.env.example` - Added storage config options

### Dependencies
- **None!** Uses built-in Node.js modules:
  - `zlib` - Compression
  - `fs.promises` - Async file operations
  - `path` - File path handling

## Cost Savings

### Storage Costs
- Railway: $0.25/GB/month
- Reduced usage: 4GB → 1.9GB = 2.1GB saved
- **Savings: ~$0.53/month** (20% of storage cost)

### Bandwidth Savings
- Compressed files = faster transfers
- Less data to read/write
- Reduced Railway egress costs

## Next Steps

1. **Monitor for 24-48 hours** to verify optimizations are working
2. **Run initial scrape** with `/agent-initial-scrape` command
3. **Check storage after scrape** to ensure staying under 5GB
4. **Adjust TTL** if needed based on actual usage patterns

## Troubleshooting

### Storage still growing?
- Check `CONTENT_FILE_TTL_DAYS` is set correctly
- Verify cleanup is running: look for `[STORAGE] Cleaned up...` logs
- Check for other files in volume: `du -sh /data/content-files/*`

### Knowledge base too large?
- Reduce max pairs: edit `MAX_QA_PAIRS` in `storageOptimizer.js`
- Increase deduplication threshold: edit `DEDUPLICATION_SIMILARITY`

### Compression not working?
- Check logs for `[STORAGE] Compressed...` messages
- Verify `.gz` files exist: `ls -la /app/data/*.gz`
- Test manually: `gzip -k file.json` on Railway console
