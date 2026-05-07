import { createHash, createHmac } from "node:crypto";

function sha1Hex(input) {
  return createHash("sha1").update(input).digest("hex");
}

function hmacSha1(key, input, encoding = "hex") {
  return createHmac("sha1", key).update(input).digest(encoding);
}

function getCosConfig() {
  const {
    TENCENT_COS_SECRET_ID,
    TENCENT_COS_SECRET_KEY,
    TENCENT_COS_BUCKET,
    TENCENT_COS_REGION,
    TENCENT_COS_PODCAST_PREFIX = "podcasts",
    TENCENT_COS_PUBLIC_BASE_URL,
  } = process.env;

  const missing = [
    ["TENCENT_COS_SECRET_ID", TENCENT_COS_SECRET_ID],
    ["TENCENT_COS_SECRET_KEY", TENCENT_COS_SECRET_KEY],
    ["TENCENT_COS_BUCKET", TENCENT_COS_BUCKET],
    ["TENCENT_COS_REGION", TENCENT_COS_REGION],
    ["TENCENT_COS_PUBLIC_BASE_URL", TENCENT_COS_PUBLIC_BASE_URL],
  ].filter(([, v]) => !v);

  if (missing.length > 0) {
    throw new Error(`Missing COS env: ${missing.map(([k]) => k).join(", ")}`);
  }

  return {
    secretId: TENCENT_COS_SECRET_ID.trim(),
    secretKey: TENCENT_COS_SECRET_KEY.trim(),
    bucket: TENCENT_COS_BUCKET.trim(),
    region: TENCENT_COS_REGION.trim(),
    prefix: TENCENT_COS_PODCAST_PREFIX.replace(/^\/+|\/+$/g, ""),
    publicBaseUrl: TENCENT_COS_PUBLIC_BASE_URL.replace(/\/+$/, ""),
  };
}

function buildCosAuthorization({ secretId, secretKey, method, pathname, host }) {
  const now = Math.floor(Date.now() / 1000);
  const signTime = `${now - 60};${now + 600}`;
  const keyTime = signTime;

  const httpString = `${method.toLowerCase()}\n${pathname}\n\nhost=${host}\n`;
  const sha1edHttpString = sha1Hex(httpString);
  const stringToSign = `sha1\n${signTime}\n${sha1edHttpString}\n`;

  const signKey = hmacSha1(secretKey, keyTime);
  const signature = hmacSha1(Buffer.from(signKey, "hex"), stringToSign);

  return [
    "q-sign-algorithm=sha1",
    `q-ak=${encodeURIComponent(secretId)}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${keyTime}`,
    "q-header-list=host",
    "q-url-param-list=",
    `q-signature=${signature}`,
  ].join("&");
}

export async function uploadPodcastToCos({ filename, contentType, body }) {
  const cfg = getCosConfig();
  const key = `${cfg.prefix}/${filename}`;
  const pathname = `/${key}`;
  const host = `${cfg.bucket}.cos.${cfg.region}.myqcloud.com`;
  const url = `https://${host}${pathname}`;

  const authorization = buildCosAuthorization({
    secretId: cfg.secretId,
    secretKey: cfg.secretKey,
    method: "PUT",
    pathname,
    host,
  });

  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Host: host,
      Authorization: authorization,
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(body.length),
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`COS upload failed: ${res.status} ${res.statusText} ${text}`);
  }

  return `${cfg.publicBaseUrl}/${key}`;
}
