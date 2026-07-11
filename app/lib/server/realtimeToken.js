import "server-only";

import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";

import { auth } from "@/app/auth";
import {
  getServerGeminiApiKey,
  getServerGeminiBaseUrl,
} from "@/app/lib/server/geminiConfig";

const TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const NEW_SESSION_WINDOW_MS = 2 * 60 * 1000;
const LEGACY_TOKEN_ROUTE_SUNSET = "Sun, 11 Jul 2027 00:00:00 GMT";

function addLegacyRouteHeaders(response) {
  response.headers.set("Deprecation", "true");
  response.headers.set("Sunset", LEGACY_TOKEN_ROUTE_SUNSET);
  response.headers.set(
    "Link",
    '</api/realtime-token>; rel="successor-version"'
  );

  return response;
}

function respond(response, deprecated) {
  response.headers.set("Cache-Control", "no-store");
  return deprecated ? addLegacyRouteHeaders(response) : response;
}

export async function createRealtimeTokenResponse({ deprecated = false } = {}) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return respond(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        deprecated
      );
    }

    const apiKey = getServerGeminiApiKey();

    if (!apiKey) {
      return respond(
        NextResponse.json(
          { error: "Google API key not configured" },
          { status: 500 }
        ),
        deprecated
      );
    }

    const geminiBaseUrl = getServerGeminiBaseUrl();
    const client = new GoogleGenAI({
      apiKey,
      ...(geminiBaseUrl
        ? { httpOptions: { baseUrl: geminiBaseUrl, apiVersion: "v1alpha" } }
        : { httpOptions: { apiVersion: "v1alpha" } }),
    });

    const now = Date.now();
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(now + TOKEN_LIFETIME_MS).toISOString(),
        newSessionExpireTime: new Date(
          now + NEW_SESSION_WINDOW_MS
        ).toISOString(),
        httpOptions: {
          apiVersion: "v1alpha",
        },
      },
    });

    return respond(NextResponse.json({ token: token.name }), deprecated);
  } catch (error) {
    console.error("Error creating realtime token:", error);
    return respond(
      NextResponse.json({ error: "Failed to create token" }, { status: 500 }),
      deprecated
    );
  }
}
