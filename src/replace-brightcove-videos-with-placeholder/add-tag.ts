/**
 * Script to manually add the placeholder-replaced tag to a video
 * Usage: bun run add-tag.ts <video_id>
 */

import secret from "./siemens-cc-secret.json";

const ACCOUNT_ID = "1813624294001";
const TAG = "placeholder-replaced";

const videoId = process.argv[2];

if (!videoId) {
  console.error("Usage: bun run add-tag.ts <video_id>");
  process.exit(1);
}

async function main() {
  console.log(`🏷️  Adding tag to video ${videoId}...`);

  // Get token
  const tokenRes = await fetch("https://oauth.brightcove.com/v4/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(secret.client_id + ":" + secret.client_secret).toString(
          "base64",
        ),
    },
    body: "grant_type=client_credentials",
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  // Get current tags
  const videoRes = await fetch(
    `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${videoId}`,
    {
      headers: { Authorization: `Bearer ${access_token}` },
    },
  );

  if (!videoRes.ok) {
    console.error(`❌ Failed to fetch video: ${await videoRes.text()}`);
    process.exit(1);
  }

  const video = (await videoRes.json()) as { tags?: string[] };
  const currentTags: string[] = video.tags || [];

  console.log(`  Current tags: ${currentTags.join(", ") || "(none)"}`);

  if (currentTags.includes(TAG)) {
    console.log("✅ Video already has the tag");
    return;
  }

  // Add tag
  const patchRes = await fetch(
    `https://cms.api.brightcove.com/v1/accounts/${ACCOUNT_ID}/videos/${videoId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${access_token}`,
      },
      body: JSON.stringify({ tags: [...currentTags, TAG] }),
    },
  );

  if (patchRes.ok) {
    console.log(`✅ Tag "${TAG}" added successfully`);
  } else {
    console.error(`❌ Failed to add tag: ${await patchRes.text()}`);
    process.exit(1);
  }
}

main();
