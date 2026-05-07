import COS from "cos-nodejs-sdk-v5";

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
    secretId: TENCENT_COS_SECRET_ID,
    secretKey: TENCENT_COS_SECRET_KEY,
    bucket: TENCENT_COS_BUCKET,
    region: TENCENT_COS_REGION,
    prefix: TENCENT_COS_PODCAST_PREFIX.replace(/^\/+|\/+$/g, ""),
    publicBaseUrl: TENCENT_COS_PUBLIC_BASE_URL.replace(/\/+$/, ""),
  };
}

function putObject(cos, params) {
  return new Promise((resolve, reject) => {
    cos.putObject(params, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export async function uploadPodcastToCos({ filename, contentType, body }) {
  const cfg = getCosConfig();
  const cos = new COS({ SecretId: cfg.secretId, SecretKey: cfg.secretKey });
  const key = `${cfg.prefix}/${filename}`;

  await putObject(cos, {
    Bucket: cfg.bucket,
    Region: cfg.region,
    Key: key,
    Body: body,
    ContentType: contentType,
  });

  return `${cfg.publicBaseUrl}/${key}`;
}
