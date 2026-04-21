import path from "node:path";
import { access, mkdir, writeFile } from "node:fs/promises";
import { fetchPodcastNews } from "@/app/lib/podcast/news";
import { generatePodcastScript } from "@/app/lib/podcast/script";
import { synthesizePodcast } from "@/app/lib/podcast/tts";
import {
  loadManifest,
  upsertEpisode,
  saveManifest,
  writeFeed,
  buildEpisodeEnclosureUrl,
} from "@/app/lib/podcast/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PODCAST_DIR = path.join(process.cwd(), "public", "podcasts");
const MANIFEST_PATH = path.join(PODCAST_DIR, "manifest.json");
const FEED_PATH = path.join(PODCAST_DIR, "feed.xml");

let inFlight = false;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderScriptTxt(id, script) {
  const lines = [
    `LingDaily ${id}`,
    `${script.episode_title}`,
    ``,
    script.episode_summary,
    ``,
    `${"─".repeat(60)}`,
  ];
  for (const chunk of script.chunks) {
    lines.push(``, `[ ${chunk.name.toUpperCase()} ]`, ``);
    for (const turn of chunk.turns) {
      lines.push(`${turn.speaker}: ${turn.text}`, ``);
    }
  }
  return lines.join("\n");
}

function checkSecret(req) {
  const expected = process.env.PODCAST_SECRET;
  if (!expected) return { ok: false, reason: "PODCAST_SECRET not configured" };
  const provided = req.headers.get("x-podcast-secret");
  if (!provided || provided !== expected) return { ok: false, reason: "Invalid secret" };
  return { ok: true };
}

function todayId() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req) {
  const secretCheck = checkSecret(req);
  if (!secretCheck.ok) {
    return jsonResponse({ error: secretCheck.reason }, 401);
  }

  if (inFlight) {
    return jsonResponse({ error: "A podcast generation is already in progress" }, 429);
  }

  inFlight = true;
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date")?.trim();
    const force = searchParams.get("force") === "true";
    const id = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayId();

    await mkdir(PODCAST_DIR, { recursive: true });
    const mp3Filename = `${id}.mp3`;
    const mp3Path = path.join(PODCAST_DIR, mp3Filename);

    if (!force && (await fileExists(mp3Path))) {
      return jsonResponse(
        { error: `Episode ${id} already exists. Pass ?force=true to overwrite.` },
        409
      );
    }

    const news = await fetchPodcastNews();
    const script = await generatePodcastScript(news);

    const txtPath = path.join(PODCAST_DIR, `${id}.txt`);
    await writeFile(txtPath, renderScriptTxt(id, script), "utf8");

    const workDir = path.join(PODCAST_DIR, `.work-${id}`);
    const { size, duration } = await synthesizePodcast(script, {
      outputMp3Path: mp3Path,
      workDir,
    });

    const pubDate = new Date().toISOString();
    const episode = {
      id,
      title: script.episode_title,
      summary: script.episode_summary,
      pubDate,
      filename: mp3Filename,
      size,
      duration,
    };

    const manifest = await loadManifest(MANIFEST_PATH);
    const updated = await upsertEpisode(manifest, episode);
    await saveManifest(MANIFEST_PATH, updated);
    await writeFeed(FEED_PATH, updated);

    return jsonResponse({
      ok: true,
      episode,
      enclosureUrl: buildEpisodeEnclosureUrl(mp3Filename),
      totalEpisodes: updated.episodes.length,
    });
  } catch (error) {
    console.error("[podcast/generate] Error:", error);
    return jsonResponse({ error: error?.message || "Unexpected error" }, 500);
  } finally {
    inFlight = false;
  }
}
