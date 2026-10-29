# Gemini 3.8 fixed-voice podcast operation

## Release path

Push to `main` runs `.github/workflows/deploy.yml`: lint, JS/Python tests, isolated migration smoke tests and production build; then build/push `ghcr.io/jackyinpei/lingdaily:latest`; finally the existing server pulls and recreates its Compose service. Do not replace this path with a VPS-built derived image. Keep the stable Server Actions encryption key and existing public build settings unchanged.

The workflow **does not synchronize host Compose, .env or cron files**. Provision those host settings before the first release and verify them after deployment; source changes alone do not make them live. Never put API keys in this document, Git or deployment output.

## Runtime setup

The existing Gemini key/base URL configuration is reused. These are additional **server-side** settings:

```dotenv
PODCAST_TTS_MODEL=gemini-3.8-flash-tts
PODCAST_TTS_VOICE_LL=voice_8etuvsmljdx4
PODCAST_TTS_VOICE_DD=voice_7e9sfi9v99r3
PODCAST_TTS_CONCURRENCY=1
PODCAST_TTS_MAX_RETRIES=5
PODCAST_TTS_CALL_TIMEOUT_MS=240000
PODCAST_TTS_DEADLINE_MS=6600000
PODCAST_CACHE_DIR=/app/podcast-cache
PODCAST_TTS_STYLE=bright, warm morning conversation; alert and engaged, with a natural smile; clear, steady pace and vocal register throughout; no shouting, dramatic emphasis or closing flourish
```

The voice identifiers are existing, approved resources, not API keys. Do not recreate them on every release. Missing voices fail explicitly; the renderer does not silently fall back to another model or character.

Compose must bind `./podcast-cache:/app/podcast-cache` **outside** the public podcasts mount. Create the host cache with mode `0700`. `.env` is `0600`. No cache or audio enters the image context or Git.

Install `scripts/podcast-cron.py` at `/root/lingdaily/podcast-cron.py` with mode `0700`; the existing `cron_generate.sh` invokes `/usr/bin/python3 /root/lingdaily/podcast-cron.py`. Keep the existing 05:00 schedule/timezone. The Python trigger reads the local private .env, holds a nonblocking process lock, makes at most three same-date requests without `force=true`, bounds each request to 7200 seconds and the entire run to 10800 seconds. It logs statuses, not keys or provider response bodies. Set the site reverse proxy read/send timeout to 7500 seconds; test nginx config before reload.

## Recovery and provenance

Private checkpoints are grouped by date and canonical script fingerprint. A failed ordinary retry reuses that saved script and successful raw PCM turns. Text/model/voice/style/format changes invalidate incompatible turn caches. `force=true` generates a new script intentionally; it is not the normal recovery action. Full output is assembled only after all turns pass validation.

`script.json`, per-turn metadata and `tts.json` preserve requested model, returned modelVersion, voice, attempts and cache provenance. PCM is kept before edge trim and loudness levelling; no pitch conversion is used. There is no automatic cache retention policy: monitor disk usage and archive old date directories deliberately. No public/RSS item is created by the opt-in live test.

## Verification

```bash
npm run lint -- --max-warnings=0
npm test
python3 -m unittest discover -s tests/ops -v
npm run test:migrations
npm run build
```

The live fixture test is skipped in ordinary CI. Explicit authorized use requires `LINGDAILY_LIVE_TTS=1`, `LINGDAILY_SAMPLE_SCRIPT`, `LINGDAILY_SAMPLE_DIR`, plus the runtime voice/API settings. It performs real synthesis and a second cached render, checking that the cached MP3 is identical without more API attempts. Do not enable it in routine CI.

After deployment inspect the actual container image, fixed voices, cache mount and model settings without printing secrets; verify unauthenticated generation is rejected, homepage/API/feed remain reachable and existing feed/audio still work. Do not trigger a public paid episode merely to health-check the release. Audio decoding/mock tests do not prove speaker identity, complete transcription or subjective delivery quality.

## Rollback

Before deployment retain a tagged old image plus private copies of Compose, .env, cron and nginx configuration. On the existing host, the original image is tagged `lingdaily-local:pre-gemini38-20261029`; restore the matching saved Compose/env if rolling back. Recreate only `app`, do not delete public episodes or private checkpoints. Revert the source commit as well so the next CI release does not unknowingly restore the failed change. Do not use untagged-image pruning as a rollback strategy.
