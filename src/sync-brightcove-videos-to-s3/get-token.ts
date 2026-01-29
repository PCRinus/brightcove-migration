// Generate a Brightcove OAuth token
// Usage: bun src/sync-brightcove-videos-to-s3/get-token.ts

const scriptDir = import.meta.dir;
const secret = await Bun.file(`${scriptDir}/../../secret.json`).json();
const CLIENT_ID = secret.client_id;
const CLIENT_SECRET = secret.client_secret;

const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

const response = await fetch("https://oauth.brightcove.com/v4/access_token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    Authorization: `Basic ${credentials}`,
  },
  body: "grant_type=client_credentials",
});

if (!response.ok) {
  console.error(`Failed to get token: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const data = await response.json() as { access_token: string; expires_in: number };

console.log(`\nBrightcove Access Token (expires in ${data.expires_in}s):\n`);
console.log(data.access_token);
console.log();
