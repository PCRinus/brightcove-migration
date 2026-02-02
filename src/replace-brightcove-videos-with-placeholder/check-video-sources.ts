/**
 * Check the sources/renditions of a video.
 *
 * Usage:
 *   bun run check-video-sources.ts <video_id>
 */

const scriptDir = import.meta.dir;
const secret = await Bun.file(`${scriptDir}/siemens-cc-secret.json`).json();
const ACCOUNT_ID = secret.maximum_scope[0].identity["account-id"].toString();
const CLIENT_ID = secret.client_id;
const CLIENT_SECRET = secret.client_secret;

const VIDEO_ID = process.argv[2];

if (!VIDEO_ID) {
  console.log("Usage: bun run check-video-sources.ts <video_id>");
  process.exit(1);
}

async function getAccessToken(): Promise<string> {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
    "base64",
  );
  const response = await fetch("https://oauth.brightcove.com/v4/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${credentials}`,
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    throw new Error(`Failed to get access token: ${response.status}`);
  }
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function main() {
  console.log(`\n🔍 Checking sources for video ${VIDEO_ID}...\n`);

  const accessToken = await getAccessToken();

  // Get video details
  const videoUrl = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${VIDEO_ID}`;
  const videoRes = await fetch(videoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const videoData = (await videoRes.json()) as any;

  console.log("📹 Video Info:");
  console.log("─".repeat(50));
  console.log(`  Name: ${videoData.name}`);
  console.log(`  State: ${videoData.state}`);
  console.log(`  Complete: ${videoData.complete}`);
  console.log(`  Delivery Type: ${videoData.delivery_type}`);
  console.log(`  Has Digital Master: ${videoData.has_digital_master}`);
  console.log(`  Duration: ${videoData.duration}ms`);
  console.log(`  Tags: ${(videoData.tags || []).join(", ")}`);

  // Get sources
  const sourcesUrl = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${VIDEO_ID}/sources`;
  const sourcesRes = await fetch(sourcesUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const sources = (await sourcesRes.json()) as any[];

  console.log("\n📦 Sources/Renditions:");
  console.log("─".repeat(50));

  if (!sources || sources.length === 0) {
    console.log("  ⚠️  NO SOURCES FOUND - This explains the playback error!");
  } else {
    sources.forEach((source, i) => {
      console.log(
        `\n  [${i + 1}] ${source.type || source.container || "Unknown type"}`,
      );
      if (source.codec) console.log(`      Codec: ${source.codec}`);
      if (source.width && source.height)
        console.log(`      Resolution: ${source.width}x${source.height}`);
      if (source.encoding_rate)
        console.log(
          `      Bitrate: ${Math.round(source.encoding_rate / 1000)}kbps`,
        );
      if (source.src)
        console.log(`      URL: ${source.src.substring(0, 80)}...`);
    });
  }

  // Get dynamic renditions
  const renditionsUrl = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${VIDEO_ID}/assets/dynamic_renditions`;
  const renditionsRes = await fetch(renditionsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (renditionsRes.ok) {
    const renditions = (await renditionsRes.json()) as any[];
    console.log("\n📊 Dynamic Renditions:");
    console.log("─".repeat(50));

    if (!renditions || renditions.length === 0) {
      console.log("  ⚠️  NO DYNAMIC RENDITIONS - Transcoding may have failed");
    } else {
      renditions.forEach((r) => {
        console.log(
          `  - ${r.rendition_id}: ${r.media_type} ${r.frame_width || ""}x${r.frame_height || ""} @ ${r.encoding_rate}kbps`,
        );
      });
    }
  }

  // Check all ingest jobs for this video
  const jobsUrl = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${VIDEO_ID}/ingest_jobs`;
  const jobsRes = await fetch(jobsUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const jobs = (await jobsRes.json()) as any[];

  console.log("\n📋 All Ingest Jobs:");
  console.log("─".repeat(50));
  jobs.forEach((job) => {
    const status = job.error_code
      ? `❌ ${job.state} (${job.error_code})`
      : `${job.state}`;
    console.log(`  - ${job.id}: ${status}`);
    if (job.error_message) console.log(`    Error: ${job.error_message}`);
  });
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
