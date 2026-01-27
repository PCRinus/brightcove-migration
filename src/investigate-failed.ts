const secret = await Bun.file("secret.json").json();
const ACCOUNT_ID = secret.maximum_scope[0].identity["account-id"].toString();
const CLIENT_ID = secret.client_id;
const CLIENT_SECRET = secret.client_secret;

let accessToken = "";

async function getAccessToken(): Promise<string> {
  console.log("Fetching new access token...");
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
    "base64"
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
      `Failed to get access token: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  console.log(`Token acquired (expires in ${data.expires_in}s)\n`);
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
}

async function fetchVideoSources(videoId: string): Promise<VideoSource[]> {
  const url = `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${videoId}/sources`;

  let response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 401) {
    accessToken = await getAccessToken();
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return (await response.json()) as VideoSource[];
}

interface VideoSourceEntry {
  videoId: string;
  url: string | null;
  resolution: string;
}

async function main() {
  const videoSources: VideoSourceEntry[] = await Bun.file(
    "video_sources.json"
  ).json();

  const noMp4Videos = videoSources.filter(
    (v) => v.url === null && v.resolution === "no MP4 found"
  );
  const errorVideos = videoSources.filter((v) => v.resolution === "error");

  console.log(`Videos without MP4: ${noMp4Videos.length}`);
  console.log(`Videos with errors: ${errorVideos.length}\n`);

  accessToken = await getAccessToken();

  console.log("=== Analyzing videos without MP4 sources ===\n");

  const noMp4Analysis: {
    videoId: string;
    availableFormats: string[];
    hasHLS: boolean;
    hasDASH: boolean;
    isEmpty: boolean;
  }[] = [];

  for (const video of noMp4Videos) {
    try {
      const sources = await fetchVideoSources(video.videoId);

      const formats = sources.map((s) => {
        if (s.container) return `${s.container} ${s.width}x${s.height}`;
        if (s.type === "application/x-mpegURL") return "HLS";
        if (s.type === "application/dash+xml") return "DASH";
        return s.type || "unknown";
      });

      const hasHLS = sources.some((s) => s.type === "application/x-mpegURL");
      const hasDASH = sources.some((s) => s.type === "application/dash+xml");

      noMp4Analysis.push({
        videoId: video.videoId,
        availableFormats: [...new Set(formats)],
        hasHLS,
        hasDASH,
        isEmpty: sources.length === 0,
      });

      console.log(`${video.videoId}: ${formats.join(", ") || "NO SOURCES"}`);
    } catch (error) {
      console.log(`${video.videoId}: ERROR - ${error}`);
      noMp4Analysis.push({
        videoId: video.videoId,
        availableFormats: [],
        hasHLS: false,
        hasDASH: false,
        isEmpty: true,
      });
    }
  }

  console.log("\n=== Retrying videos that errored ===\n");

  const retryResults: VideoSourceEntry[] = [];

  for (const video of errorVideos) {
    try {
      const sources = await fetchVideoSources(video.videoId);

      const mp4Sources = sources.filter(
        (s) => s.container === "MP4" && s.src.startsWith("https://")
      );
      mp4Sources.sort((a, b) => (b.height || 0) - (a.height || 0));

      if (mp4Sources.length > 0) {
        const best = mp4Sources[0]!;
        console.log(
          `${video.videoId}: SUCCESS - Found MP4 ${best.width}x${best.height}`
        );
        retryResults.push({
          videoId: video.videoId,
          url: best.src,
          resolution: `${best.width}x${best.height}`,
        });
      } else {
        const formats = sources.map((s) => s.type || s.container || "unknown");
        console.log(
          `${video.videoId}: No MP4, has: ${[...new Set(formats)].join(", ")}`
        );
        retryResults.push({
          videoId: video.videoId,
          url: null,
          resolution: "no MP4 found",
        });
      }
    } catch (error) {
      console.log(`${video.videoId}: STILL FAILING - ${error}`);
      retryResults.push({
        videoId: video.videoId,
        url: null,
        resolution: "error",
      });
    }
  }

  console.log("\n=== SUMMARY ===\n");

  const hlsOnly = noMp4Analysis.filter((v) => v.hasHLS && !v.isEmpty);
  const emptyVideos = noMp4Analysis.filter((v) => v.isEmpty);
  const retriedSuccess = retryResults.filter((v) => v.url !== null);

  console.log(`Videos with HLS/DASH only (need ffmpeg): ${hlsOnly.length}`);
  console.log(`Videos with no sources at all: ${emptyVideos.length}`);
  console.log(`Error videos recovered on retry: ${retriedSuccess.length}`);

  await Bun.write(
    "failed_videos_analysis.json",
    JSON.stringify(
      {
        noMp4Analysis,
        retryResults,
        summary: {
          hlsOnlyCount: hlsOnly.length,
          emptyCount: emptyVideos.length,
          recoveredCount: retriedSuccess.length,
        },
      },
      null,
      2
    )
  );
  console.log("\nDetailed analysis saved to failed_videos_analysis.json");

  // If we recovered any, offer to update video_sources.json
  if (retriedSuccess.length > 0) {
    console.log(
      `\n${retriedSuccess.length} videos recovered! Updating video_sources.json...`
    );

    const updatedSources = videoSources.map((v) => {
      const recovered = retriedSuccess.find((r) => r.videoId === v.videoId);
      return recovered || v;
    });

    await Bun.write(
      "video_sources.json",
      JSON.stringify(updatedSources, null, 2)
    );
    console.log("video_sources.json updated!");
  }
}

main();
