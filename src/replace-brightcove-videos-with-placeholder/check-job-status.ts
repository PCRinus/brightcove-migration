/**
 * Check the status of an ingest job.
 *
 * Usage:
 *   bun run check-job-status.ts <video_id> <job_id>
 *   bun run check-job-status.ts 6343959819112 3edb1e77-bd52-414b-b007-4f8602dc4982
 */

const scriptDir = import.meta.dir;
const secret = await Bun.file(`${scriptDir}/siemens-cc-secret.json`).json();
const ACCOUNT_ID = secret.maximum_scope[0].identity["account-id"].toString();
const CLIENT_ID = secret.client_id;
const CLIENT_SECRET = secret.client_secret;

const VIDEO_ID = process.argv[2];
const JOB_ID = process.argv[3];

if (!VIDEO_ID || !JOB_ID) {
  console.log("Usage: bun run check-job-status.ts <video_id> <job_id>");
  console.log("\nOr check from checkpoint file:");

  try {
    const checkpoint = await Bun.file(
      `${scriptDir}/replace_checkpoint.json`,
    ).json();
    console.log("\n📋 Jobs from checkpoint:");
    for (const [videoId, job] of Object.entries(checkpoint.jobs)) {
      const j = job as { jobId: string; submittedAt: string; tagged: boolean };
      console.log(`  Video: ${videoId}`);
      console.log(`  Job ID: ${j.jobId}`);
      console.log(`  Submitted: ${j.submittedAt}`);
      console.log("");
    }
  } catch {
    console.log("  No checkpoint file found.");
  }
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
  console.log(`\n🔍 Checking job status for video ${VIDEO_ID}...\n`);

  const accessToken = await getAccessToken();

  // Check job status
  const jobUrl = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${VIDEO_ID}/ingest_jobs/${JOB_ID}`;
  const jobRes = await fetch(jobUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!jobRes.ok) {
    console.log(`❌ Failed to get job status: HTTP ${jobRes.status}`);
    const body = await jobRes.text();
    console.log(body);
    return;
  }

  const jobData = await jobRes.json();

  console.log("📋 Ingest Job Status:");
  console.log("─".repeat(50));
  console.log(JSON.stringify(jobData, null, 2));
  console.log("─".repeat(50));

  // Interpret the status
  const state = (jobData as { state?: string }).state;
  switch (state) {
    case "processing":
      console.log("\n⏳ Status: PROCESSING - Transcoding is underway");
      break;
    case "publishing":
      console.log("\n📤 Status: PUBLISHING - At least one rendition is ready");
      break;
    case "published":
      console.log("\n✅ Status: PUBLISHED - Renditions available for playback");
      break;
    case "finished":
      console.log(
        "\n🎉 Status: FINISHED - Processing complete, video replaced!",
      );
      break;
    case "failed":
      console.log("\n❌ Status: FAILED - Something went wrong");
      const errorCode = (jobData as { error_code?: string }).error_code;
      const errorMsg = (jobData as { error_message?: string }).error_message;
      if (errorCode) console.log(`   Error code: ${errorCode}`);
      if (errorMsg) console.log(`   Error message: ${errorMsg}`);
      break;
    default:
      console.log(`\n❓ Status: ${state || "UNKNOWN"}`);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
