// Extract videos that failed or have no sources

const scriptDir = import.meta.dir;

const videoSources = await Bun.file(`${scriptDir}/video_sources.json`).json() as Array<{
  videoId: string;
  url: string | null;
  resolution: string;
}>;

let uploadErrors: { videoId: string; error: string }[] = [];
try {
  uploadErrors = await Bun.file(`${scriptDir}/upload_errors.json`).json();
} catch {
  // File doesn't exist yet
}

const noSources = videoSources.filter(v => v.url === null).map(v => v.videoId);

const failedIds = new Set(uploadErrors.map(e => e.videoId));

const allMissing = new Set([...noSources, ...failedIds]);

console.log(`\n=== Missing Videos Summary ===`);
console.log(`Videos with no sources: ${noSources.length}`);
console.log(`Failed uploads: ${uploadErrors.length}`);
console.log(`Total unique missing: ${allMissing.size}`);

const output = Array.from(allMissing).sort().join("\n");

await Bun.write(`${scriptDir}/missing_videos.txt`, output);
console.log(`\nExtracted ${allMissing.size} missing video IDs to missing_videos.txt`);

// Also show details about each error
if (uploadErrors.length > 0) {
  console.log(`\n=== Failed Upload Details ===`);
  for (const err of uploadErrors.slice(0, 10)) {
    console.log(`${err.videoId}: ${err.error}`);
  }
  if (uploadErrors.length > 10) {
    console.log(`... and ${uploadErrors.length - 10} more`);
  }
}
