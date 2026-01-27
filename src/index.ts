const secret = await Bun.file("secret.json").json();
const ACCOUNT_ID = secret.maximum_scope[0].identity["account-id"].toString();
const CLIENT_ID = secret.client_id;
const CLIENT_SECRET = secret.client_secret;

let accessToken = "";

async function getAccessToken(): Promise<string> {
  console.log("Fetching new access token...");
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
    throw new Error(
      `Failed to get access token: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  console.log(`Token acquired (expires in ${data.expires_in}s)`);
  return data.access_token;
}

interface VideoSource {
  src: string;
  type?: string;
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  size?: number;
  duration?: number;
  encoding_rate?: number;
}

async function fetchVideoSources(videoId: string): Promise<VideoSource[]> {
  const url = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${videoId}/sources`;

  let response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  // If unauthorized, refresh token and retry once
  if (response.status === 401) {
    console.log(`Token expired, refreshing...`);
    accessToken = await getAccessToken();
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  if (!response.ok) {
    throw new Error(
      `Failed to fetch sources for ${videoId}: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as VideoSource[];
}

// Get best MP4 source (highest resolution HTTPS)
function getBestMp4Source(sources: VideoSource[]): VideoSource | null {
  const mp4Sources = sources.filter(
    (s) => s.container === "MP4" && s.src.startsWith("https://"),
  );

  if (mp4Sources.length === 0) return null;

  // Sort by height descending to get highest resolution
  mp4Sources.sort((a, b) => (b.height || 0) - (a.height || 0));
  return mp4Sources[0] ?? null;
}

async function main() {
  accessToken = await getAccessToken();

  const idsFileContent = await Bun.file("src/brightcoveIds.txt").text();
  const videoIds = idsFileContent.trim().split("\n");

  console.log(`\nProcessing ${videoIds.length} videos...\n`);

  const results: { videoId: string; url: string | null; resolution: string }[] =
    [];
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < videoIds.length; i++) {
    const videoId = videoIds[i]!;

    try {
      const sources = await fetchVideoSources(videoId);
      const bestSource = getBestMp4Source(sources);

      if (bestSource) {
        results.push({
          videoId,
          url: bestSource.src,
          resolution: `${bestSource.width}x${bestSource.height}`,
        });
        successCount++;
      } else {
        results.push({ videoId, url: null, resolution: "no MP4 found" });
        console.log(
          `[${i + 1}/${videoIds.length}] ${videoId}: No MP4 source found`,
        );
      }

      // Progress log every 100 videos
      if ((i + 1) % 100 === 0) {
        console.log(
          `[${i + 1}/${videoIds.length}] Processed... (${successCount} success, ${errorCount} errors)`,
        );
      }
    } catch (error) {
      errorCount++;
      console.error(`[${i + 1}/${videoIds.length}] ${videoId}: ${error}`);
      results.push({ videoId, url: null, resolution: "error" });
    }
  }

  console.log(`\n--- Complete ---`);
  console.log(`Total: ${videoIds.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);

  await Bun.write("video_sources.json", JSON.stringify(results, null, 2));
  console.log(`\nResults saved to video_sources.json`);
}

main();
