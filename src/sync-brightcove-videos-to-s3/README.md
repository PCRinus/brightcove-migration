# Sync Brightcove Videos to S3

Downloads MP4 video sources from Brightcove and uploads them to AWS S3.

**S3 destination:** `s3://intranet-static-dc-siemens-com-content/brightcove-cleanup/`

## Scripts

All scripts should be run from the repository root.

### Generate Brightcove Token

```bash
bun src/sync-brightcove-videos-to-s3/get-token.ts
```

Generates a fresh OAuth token (valid for 5 minutes). Useful for manual API testing.

### Upload Videos to S3

```bash
bun src/sync-brightcove-videos-to-s3/upload-to-s3.ts
```

Downloads videos from Brightcove and uploads them to S3. Features:
- Automatic token refresh
- Checkpoint-based resume (safe to restart)
- Parallel uploads (5 concurrent)
- Retry logic for transient failures

### Extract Missing Videos

```bash
bun src/sync-brightcove-videos-to-s3/extract-missing.ts
```

Lists videos that could not be migrated (no sources available or upload failed). Outputs to `missing_videos.txt`.

## Data Files

| File | Description |
|------|-------------|
| `brightcoveIds.txt` | Input list of Brightcove video IDs (one per line) |
| `video_sources.json` | Cached video metadata and URLs |
| `upload_checkpoint.json` | Progress tracker for resume capability |
| `missing_videos.txt` | IDs of videos that couldn't be migrated |
