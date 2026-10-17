# Volume Optimization Script
# Run this to clean up old files and free space

cd /app/data 2>/dev/null || cd /data 2>/dev/null || exit 0

echo "=== Volume Usage Before Cleanup ==="
du -h -d 1 . 2>/dev/null | sort -h

# Remove old log files
echo "Cleaning old logs..."
find . -name "*.log" -mtime +7 -delete 2>/dev/null
find . -name "*.log.*" -delete 2>/dev/null

# Compress large learnings file if > 1MB
if [ -f "learnings.md" ]; then
    SIZE=$(stat -f%z learnings.md 2>/dev/null || stat -c%s learnings.md 2>/dev/null)
    if [ "$SIZE" -gt 1048576 ]; then
        echo "Compressing large learnings.md..."
        tail -n 500 learnings.md > learnings.md.tmp
        mv learnings.md.tmp learnings.md
    fi
fi

# Remove old temp files
find . -name "*.tmp" -delete 2>/dev/null
find . -name "*.cache" -delete 2>/dev/null

# Clean content-files if exists
if [ -d "content-files" ]; then
    echo "Cleaning old content files..."
    find content-files -type f -mtime +30 -delete 2>/dev/null
    find content-files -type d -empty -delete 2>/dev/null
fi

echo "=== Volume Usage After Cleanup ==="
du -h -d 1 . 2>/dev/null | sort -h

echo "Cleanup complete!"
