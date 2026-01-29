import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { fromIni } from "@aws-sdk/credential-providers";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent } from "node:https";

const S3_BUCKET = "intranet-static-dc-siemens-com-content";
const S3_PREFIX = "brightcove-cleanup/";
const AWS_PROFILE = "722716701248";
const CONCURRENCY = 5;

// Keep-alive agent for connection reuse
const httpsAgent = new Agent({
  keepAlive: true,
  maxSockets: 25,
});

const s3Client = new S3Client({
  credentials: fromIni({ profile: AWS_PROFILE }),
  region: "eu-central-1",
  requestHandler: new NodeHttpHandler({
    httpsAgent,
    connectionTimeout: 30000,
    socketTimeout: 300000,
  }),
});

const scriptDir = import.meta.dir;
const secret = await Bun.file(`${scriptDir}/../../secret.json`).json();
const ACCOUNT_ID = secret.maximum_scope[0].identity["account-id"].toString();
const CLIENT_ID = secret.client_id;
const CLIENT_SECRET = secret.client_secret;

let accessToken = "";

// Token refresh with mutex to prevent race conditions
let tokenRefreshPromise: Promise<string> | null = null;

async function getAccessToken(): Promise<string> {
  // If already refreshing, wait for that promise
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
      "base64",
    );
    const response = await fetch(
      "https://oauth.brightcove.com/v4/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${credentials}`,
        },
        body: "grant_type=client_credentials",
      },
    );
    if (!response.ok) {
      throw new Error(`Failed to get access token: ${response.status}`);
    }
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    console.log(`Brightcove token refreshed (expires in ${data.expires_in}s)`);
    return data.access_token;
  })();

  try {
    const token = await tokenRefreshPromise;
    return token;
  } finally {
    tokenRefreshPromise = null;
  }
}

// Helper to delay execution
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface VideoSource {
  src: string;
  container?: string;
  width?: number;
  height?: number;
}

// Fetch fresh video URL from Brightcove (with token refresh and retry)
async function getFreshVideoUrl(
  videoId: string,
  retries = 3,
): Promise<{ url: string; resolution: string } | null> {
  const apiUrl = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${videoId}/sources`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      let response = await fetch(apiUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.status === 401) {
        accessToken = await getAccessToken();
        response = await fetch(apiUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
      }

      if (!response.ok) {
        return null;
      }

      const sources = (await response.json()) as VideoSource[];
      const mp4Sources = sources.filter(
        (s) => s.container === "MP4" && s.src.startsWith("https://"),
      );

      if (mp4Sources.length === 0) return null;

      mp4Sources.sort((a, b) => (b.height || 0) - (a.height || 0));
      const best = mp4Sources[0]!;
      return {
        url: best.src,
        resolution: `${best.width}x${best.height}`,
      };
    } catch (error) {
      // Connection error - retry with backoff
      if (attempt < retries - 1) {
        const waitTime = (attempt + 1) * 2000; // 2s, 4s, 6s
        console.log(
          `  ⚠ Connection error for ${videoId}, retrying in ${waitTime / 1000}s...`,
        );
        await delay(waitTime);
        continue;
      }
      throw error;
    }
  }
  return null;
}

interface VideoSourceEntry {
  videoId: string;
  url: string | null;
  resolution: string;
}

async function loadCheckpoint(): Promise<Set<string>> {
  try {
    const data = await Bun.file(`${scriptDir}/upload_checkpoint.json`).json();
    return new Set(data.completed as string[]);
  } catch {
    return new Set();
  }
}

// Mutex for checkpoint file writes
let checkpointLock = false;
async function saveCheckpoint(completed: Set<string>): Promise<void> {
  while (checkpointLock) {
    await new Promise((r) => setTimeout(r, 10));
  }
  checkpointLock = true;
  try {
    await Bun.write(
      `${scriptDir}/upload_checkpoint.json`,
      JSON.stringify({ completed: Array.from(completed) }, null, 2),
    );
  } finally {
    checkpointLock = false;
  }
}

async function uploadVideoToS3(
  videoId: string,
  url: string,
): Promise<{
  success: boolean;
  sizeMB?: string;
  error?: string;
  needsRetry?: boolean;
}> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      const body = await response.text();
      console.log(`  [${videoId}] CDN error body: ${body.substring(0, 200)}`);
      // If 401/403, signal that we need a fresh URL
      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          error: body || `CDN URL expired: ${response.status}`,
          needsRetry: true,
        };
      }
      return {
        success: false,
        error: `Failed to fetch: ${response.status} ${response.statusText}`,
      };
    }

    const contentLength = response.headers.get("content-length");
    const sizeMB = contentLength
      ? (parseInt(contentLength) / 1024 / 1024).toFixed(2)
      : "unknown";

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: S3_BUCKET,
        Key: `${S3_PREFIX}${videoId}.mp4`,
        Body: response.body as ReadableStream,
        ContentType: "video/mp4",
      },
    });

    await upload.done();
    return { success: true, sizeMB };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    // Check if this is a token/URL expiration error that should be retried
    if (errorMsg.includes("expired") || errorMsg.includes("Unauthorized")) {
      return {
        success: false,
        error: errorMsg,
        needsRetry: true,
      };
    }
    return {
      success: false,
      error: errorMsg,
    };
  }
}

// Main execution
async function main() {
  console.log("Initializing...");
  accessToken = await getAccessToken();

  console.log("Loading video sources...");
  const videoSources: VideoSourceEntry[] =
    await Bun.file(`${scriptDir}/video_sources.json`).json();

  // Filter to only videos with valid URLs (we'll fetch fresh URLs anyway)
  const videosToUpload = videoSources.filter((v) => v.url !== null);
  console.log(
    `Found ${videosToUpload.length} videos with URLs (out of ${videoSources.length} total)\n`,
  );

  // Load checkpoint for resume capability
  const completed = await loadCheckpoint();
  console.log(`Already uploaded: ${completed.size} videos`);

  // Filter out already completed
  const pending = videosToUpload.filter((v) => !completed.has(v.videoId));
  console.log(`Remaining to upload: ${pending.length} videos`);
  console.log(`Concurrency: ${CONCURRENCY} parallel uploads`);
  console.log(`Mode: Fetching fresh URLs on-demand\n`);

  let successCount = 0;
  let errorCount = 0;
  const errors: { videoId: string; error: string }[] = [];
  const startTime = Date.now();

  // Helper function to upload a single video with retry on expired URL
  async function uploadWithRetry(
    videoId: string,
    maxRetries = 2,
  ): Promise<{
    videoId: string;
    resolution: string;
    result: { success: boolean; sizeMB?: string; error?: string };
  }> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Fetch fresh URL from Brightcove API
      const freshData = await getFreshVideoUrl(videoId);
      if (!freshData) {
        return {
          videoId,
          resolution: "N/A",
          result: { success: false, error: "No MP4 source available" },
        };
      }

      const result = await uploadVideoToS3(videoId, freshData.url);

      // If URL expired and we have retries left, try again with fresh URL
      if (result.needsRetry && attempt < maxRetries) {
        console.log(
          `  ↻ ${videoId}: URL expired, retrying (${attempt + 1}/${maxRetries})...`,
        );
        continue;
      }

      return { videoId, resolution: freshData.resolution, result };
    }

    // Should never reach here, but just in case
    return {
      videoId,
      resolution: "N/A",
      result: { success: false, error: "Max retries exceeded" },
    };
  }

  // Process in batches
  for (let i = 0; i < pending.length; i += CONCURRENCY) {
    const batch = pending.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map((video) => uploadWithRetry(video.videoId)),
    );

    // Process results
    for (const { videoId, resolution, result } of results) {
      if (result.success) {
        successCount++;
        completed.add(videoId);
        console.log(`✓ ${videoId} (${resolution}, ${result.sizeMB} MB)`);
      } else {
        errorCount++;
        errors.push({ videoId, error: result.error! });
        console.log(`✗ ${videoId}: ${result.error}`);
      }
    }

    await saveCheckpoint(completed);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const total = completed.size;
    const remaining = pending.length - (i + batch.length);
    const rate = ((successCount / (elapsed as unknown as number)) * 60).toFixed(
      1,
    );
    console.log(
      `--- Batch complete: ${total} done, ${remaining} remaining, ${rate} videos/min ---\n`,
    );
  }

  console.log(`\n=== Upload Complete ===`);
  console.log(`Total uploaded: ${completed.size}`);
  console.log(`This session: ${successCount} success, ${errorCount} errors`);
  console.log(
    `Time: ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} minutes`,
  );

  if (errors.length > 0) {
    await Bun.write(`${scriptDir}/upload_errors.json`, JSON.stringify(errors, null, 2));
    console.log(`\nErrors saved to upload_errors.json`);
  }

  console.log(`\nFiles uploaded to: s3://${S3_BUCKET}/${S3_PREFIX}`);
}

process.on("uncaughtException", (err) => {
  console.error("\n🔴 UNCAUGHT EXCEPTION:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("\n🔴 UNHANDLED REJECTION at:", promise, "reason:", reason);
  process.exit(1);
});

main().catch((err) => {
  console.error("\n🔴 MAIN CRASHED:", err);
  process.exit(1);
});
