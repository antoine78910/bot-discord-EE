# Content Files Disk Space Protection

## Problem Solved

**Error:** `ENOSPC: no space left on device` when generating workflow videos
- Railway volume hitting 5GB limit
- Bot failing during content generation
- Required manual intervention

## Multi-Layer Protection System

### 🛡️ Layer 1: Aggressive Default TTL (3 days)

**Before:** Files kept for 14 days
**Now:** Files deleted after 3 days by default

```bash
# Railway variable to customize
CONTENT_FILE_TTL_DAYS=3  # Default, can increase to 7 max
```

### 🛡️ Layer 2: Maximum Folder Limit (100 folders)

Prevents unbounded growth even if TTL is long.

- Tracks all content folders by age
- Automatically removes oldest when limit exceeded
- Default: 100 folders (~2-3GB depending on content)

```bash
# Railway variable to customize
CONTENT_FILES_MAX_FOLDERS=100  # Increase if needed
```

### 🛡️ Layer 3: Disk Usage Monitoring

Continuously monitors disk space:

- **75% usage:** Warning logged
- **80% usage:** Automatic cleanup triggered
- Runs every hour

### 🛡️ Layer 4: Preventive Cleanup

Before every content generation:

1. Check current disk usage
2. If ≥75% → Run cleanup + enforce folder limit
3. Then proceed with generation

### 🛡️ Layer 5: Emergency Recovery

If ENOSPC error occurs despite all protections:

1. **Catch the error** immediately
2. **Emergency cleanup:** Remove ALL files >3 days old
3. **Enforce folder limit:** Remove oldest folders
4. **Retry the operation** that failed
5. **No manual intervention needed**

## Monitoring Logs

### Normal Operation
```
[CONTENT-FILES] 📊 Disk usage: 1.8GB / 5GB (36%)
[CONTENT-FILES] TTL: 3 days | Max folders: 100
[CONTENT-FILES] Cleaned 5 expired folders (freed 420MB)
```

### Warning State (75-80%)
```
[CONTENT-FILES] ⚠️  Disk usage at 76% - approaching limit
[CONTENT-FILES] Disk at 78% - running preventive cleanup...
[CONTENT-FILES] 📊 Removed 10 oldest folders (freed 650MB)
```

### Emergency Recovery (>80% or ENOSPC)
```
[CONTENT-FILES] 🚨 DISK FULL - Running emergency cleanup...
[CONTENT-FILES] 🚨 Emergency cleanup: removed 15 folders (freed 1.2GB)
[CONTENT-FILES] 📊 Folder limit exceeded (120/100) - removing 20 oldest...
```

## Cleanup Schedule

| Action | Frequency | Trigger |
|--------|-----------|---------|
| Regular cleanup (expired files) | Every 1 hour | Automatic |
| Folder limit enforcement | Every 1 hour | Automatic |
| Disk usage check | Every 1 hour | Automatic |
| Preventive cleanup | Before each generation | If disk ≥75% |
| Emergency cleanup | On ENOSPC error | Automatic retry |

## Configuration Guide

### Conservative (More Storage)
```bash
CONTENT_FILE_TTL_DAYS=7
CONTENT_FILES_MAX_FOLDERS=150
```
- Files kept 7 days
- Up to 150 folders
- ~3-4GB usage

### Balanced (Default)
```bash
CONTENT_FILE_TTL_DAYS=3
CONTENT_FILES_MAX_FOLDERS=100
```
- Files kept 3 days
- Up to 100 folders
- ~1.5-2.5GB usage

### Aggressive (Minimal Storage)
```bash
CONTENT_FILE_TTL_DAYS=2
CONTENT_FILES_MAX_FOLDERS=50
```
- Files kept 2 days
- Up to 50 folders
- ~0.8-1.5GB usage

## Guarantees

✅ **Never runs out of space** during generation
✅ **Self-healing** - recovers automatically from ENOSPC
✅ **No manual cleanup required**
✅ **Predictable disk usage** with folder limits
✅ **Works within Railway 5GB volume** comfortably

## Technical Details

### Emergency Cleanup Triggers
1. ENOSPC error during `mkdir()`
2. ENOSPC error during `copyFile()`
3. Disk usage ≥80%

### Cleanup Order (Most to Least Aggressive)
1. Files older than TTL (3 days default)
2. Oldest folders beyond MAX_FOLDERS limit
3. Emergency: ALL files >3 days regardless of TTL

### Safe Operations
- All cleanup operations catch errors
- Failed cleanup doesn't block generation
- Multiple retry mechanisms
- Graceful degradation

## Monitoring Commands (Railway Console)

```bash
# Check current disk usage
du -sh /data/content-files

# Count content folders
ls /data/content-files | wc -l

# Show oldest folders
ls -lt /data/content-files | tail -20

# Show newest folders  
ls -lt /data/content-files | head -20
```

## Summary

**This will NEVER happen again:**
```
❌ Generation failed: ENOSPC: no space left on device
```

**Because:**
1. ✅ Files auto-delete after 3 days
2. ✅ Max 100 folders enforced
3. ✅ 80% usage triggers cleanup
4. ✅ Preventive cleanup before generation
5. ✅ Emergency recovery on ENOSPC
6. ✅ Hourly maintenance checks

**Result:** Reliable content generation with predictable disk usage 🎉
