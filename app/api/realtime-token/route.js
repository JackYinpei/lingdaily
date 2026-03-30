import { GoogleGenAI } from "@google/genai";
import { NextResponse } from 'next/server';
import { auth } from "@/app/auth";

export async function POST() {
    try {
        const session = await auth();
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const rawApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        const apiKey = rawApiKey ? rawApiKey.trim() : "";

        if (!apiKey) {
            return NextResponse.json({ error: 'Google API key not configured' }, { status: 500 });
        }

        const geminiBaseUrl = process.env.NEXT_PUBLIC_GEMINI_BASE_URL;
        const client = new GoogleGenAI({
            apiKey,
            ...(geminiBaseUrl
                ? { httpOptions: { baseUrl: geminiBaseUrl, apiVersion: 'v1alpha' } }
                : { httpOptions: { apiVersion: 'v1alpha' } }),
        });

        const now = new Date();
        const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
        const newSessionExpireTime = new Date(now.getTime() + 2 * 60 * 1000).toISOString();

        // Match official example: simple token without liveConnectConstraints.
        // All config (model, tools, systemInstruction) will be sent by the
        // client in the WebSocket setup message.
        const token = await client.authTokens.create({
            config: {
                uses: 1,
                expireTime: expireTime,
                newSessionExpireTime: newSessionExpireTime,
                httpOptions: {
                    apiVersion: 'v1alpha'
                },
            }
        });

        return NextResponse.json({ token: token.name });
    } catch (error) {
        console.error('Error creating token:', error);
        return NextResponse.json({ error: error.message || 'Failed to create token' }, { status: 500 });
    }
}
