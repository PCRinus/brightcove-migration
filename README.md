# Siemens Brightcove Migration

Tools for migrating and managing Brightcove video assets.

## Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0+)
- AWS CLI configured with SSO profile `722716701248`
- Brightcove API credentials in `secret.json`

### secret.json format

```json
{
  "client_id": "your-client-id",
  "client_secret": "your-client-secret",
  "maximum_scope": [
    {
      "identity": {
        "account-id": 1813624294001
      }
    }
  ]
}
```

## Installation

```bash
bun install
```

## Available Tools

| Folder | Description |
|--------|-------------|
| [sync-brightcove-videos-to-s3](src/sync-brightcove-videos-to-s3/) | Download videos from Brightcove and upload to S3 |

## Troubleshooting

### AWS Token Expired

If you see "The provided token has expired", refresh your AWS SSO session:

```bash
aws sso login --profile 722716701248
```

### Brightcove 401 Errors

Scripts automatically refresh Brightcove tokens. If issues persist, verify your `secret.json` credentials.
