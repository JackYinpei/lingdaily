/**
 * GeminiLiveService — Raw WebSocket implementation
 * Based on the official Google reference:
 * https://github.com/google-gemini/gemini-live-api-examples/tree/main/gemini-live-ephemeral-tokens-websocket
 */
import confetti from 'canvas-confetti';

const OUTPUT_SAMPLE_RATE = 24000;
const PLAYBACK_LEAD_TIME_SECONDS = 0.03;

// Tiny, non-intrusive celebration burst — small particle count, short duration,
// fired near the bottom-center so it never obscures the chat.
function fireTinyConfetti() {
    try {
        confetti({
            particleCount: 18,
            spread: 45,
            startVelocity: 25,
            scalar: 0.7,
            ticks: 120,
            origin: { x: 0.5, y: 0.85 },
            disableForReducedMotion: true,
        });
    } catch (_) { /* ignore */ }
}

// Tool declaration for extracting unfamiliar English
export const extractUnfamiliarEnglishToolDecl = {
    name: "extract_unfamiliar_english",
    description: `Call this tool after a user message to record English the user genuinely does NOT know yet.

ONLY include an item if it meets at least one of these criteria:
1. The user expressed the concept in their native language (e.g. Chinese/Japanese) instead of English — they wanted to say something but lacked the English word.
2. The user attempted an English word/phrase but clearly struggled: hesitated (\"uh\", \"um\", repeated words), used broken/incorrect grammar, substituted a wrong word, or mixed in their native language mid-phrase.
3. The user explicitly asked what a word or phrase means.
4. The user mispronounced a word badly enough to suggest they don't really know it (e.g. read "manslaughter" as "must leather").

DO NOT include:
- Common everyday English that any intermediate learner knows (e.g. "look at", "that's enough", "what do you think", "powerful tool", "bad man").
- Any word or phrase the user said fluently and correctly without hesitation.
- Full sentences the user said correctly — only extract the specific word/phrase they struggled with.

If the user's message contains no evidence of the above, call this tool with an empty items array.`,
    parameters: {
        type: "OBJECT",
        properties: {
            userMessage: {
                type: "STRING",
                description: "The user's original message that was analyzed"
            },
            items: {
                type: "ARRAY",
                description: "Words or phrases the user genuinely does not know, based strictly on the criteria above. Empty array if none qualify.",
                items: {
                    type: "OBJECT",
                    properties: {
                        text: {
                            type: "STRING",
                            description: "The English word or phrase the user does not know. If they expressed it in their native language, write the correct English equivalent here."
                        },
                        type: {
                            type: "STRING",
                            enum: ["word", "phrase", "grammar", "other"],
                            description: "Category of the item"
                        }
                    },
                    required: ["text", "type"]
                }
            },
            context: {
                type: "STRING",
                description: "Brief note on why this item was flagged (e.g. 'user said in Chinese', 'user hesitated and repeated', 'user used wrong word')"
            }
        },
        required: ["userMessage", "items"]
    }
};

export class GeminiLiveServiceImpl {
    constructor(config) {
        this.session = null; // kept for API compat: truthy when connected
        this.webSocket = null;
        this.inputAudioContext = null;
        this.outputAudioContext = null;
        this.nextStartTime = 0;
        this.mediaStream = null;
        this.scriptProcessor = null;
        this.mediaSource = null;
        this.sources = new Set();
        this.systemInstruction = "";
        this.isMuted = false;
        this.connected = false;
        this.outputGainNode = null;
        this.outputAudioReadyPromise = null;
        this.audioPlaybackChain = Promise.resolve();
        this.playbackEpoch = 0;

        this.config = config;
    }

    setMuted(muted) {
        // This control represents microphone mute. Keep model audio audible so
        // focusing the text input does not silently consume the first reply.
        this.isMuted = muted;
    }

    createOutputAudioContext() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) {
            throw new Error("Web Audio API is not supported in this browser");
        }

        this.outputAudioContext = new AudioContextClass({ sampleRate: OUTPUT_SAMPLE_RATE });
        this.outputGainNode = this.outputAudioContext.createGain();
        this.outputGainNode.gain.value = 1;
        this.outputGainNode.connect(this.outputAudioContext.destination);
        this.nextStartTime = 0;
        return this.outputAudioContext;
    }

    resumeOutputAudio() {
        const context = this.outputAudioContext;
        if (!context || context.state === 'closed') return Promise.resolve();
        if (context.state === 'running') return Promise.resolve();

        try {
            return Promise.resolve(context.resume()).catch((error) => {
                console.warn("Could not resume output AudioContext:", error);
            });
        } catch (error) {
            console.warn("Could not resume output AudioContext:", error);
            return Promise.resolve();
        }
    }

    invalidatePlayback() {
        this.playbackEpoch += 1;
        this.sources.forEach((source) => { try { source.stop(); } catch (_) { } });
        this.sources.clear();
        this.nextStartTime = this.outputAudioContext?.currentTime || 0;
        // Pending work retains its old epoch and exits before scheduling.
        this.audioPlaybackChain = Promise.resolve();
    }

    /**
     * Call this synchronously in the button click handler BEFORE any await.
     * It creates and resumes the outputAudioContext while the browser still
     * considers this a user gesture, ensuring the first audio chunk plays.
     */
    primeOutputAudio() {
        if (!this.outputAudioContext || this.outputAudioContext.state === 'closed') {
            this.createOutputAudioContext();
        }

        // Keep the promise so connect/playback can confirm that the gesture
        // actually unlocked the context instead of racing the first audio part.
        this.outputAudioReadyPromise = this.resumeOutputAudio();

        // Hard-unlock AudioContext by actually playing a silent 1-sample buffer
        // during the user gesture. On iOS/mobile, merely calling resume() is not
        // enough — the context must schedule real (even silent) audio to allow
        // future playback without another gesture.
        try {
            const silentBuffer = this.outputAudioContext.createBuffer(1, 1, OUTPUT_SAMPLE_RATE);
            const silentSource = this.outputAudioContext.createBufferSource();
            silentSource.buffer = silentBuffer;
            silentSource.connect(this.outputGainNode || this.outputAudioContext.destination);
            silentSource.start(0);
        } catch (_) { /* ignore — best-effort unlock */ }

        console.log("Output AudioContext primed, state:", this.outputAudioContext.state);
    }

    // ─── Connection ────────────────────────────────────────────────────

    async connect(systemInstruction, token) {
        this.systemInstruction = systemInstruction;
        this.invalidatePlayback();

        if (!token) {
            this.config.onError("No ephemeral token provided");
            return;
        }

        // Build WebSocket URL — use proxy base URL if configured
        const MODEL = "gemini-3.1-flash-live-preview";
        const wsPath = `/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;
        const configuredBase = process.env.NEXT_PUBLIC_GEMINI_BASE_URL;
        const wsBase = configuredBase
            ? configuredBase.replace(/^http/, 'ws').replace(/\/$/, '')
            : 'wss://generativelanguage.googleapis.com';
        const wsUrl = wsBase + wsPath;

        console.log("Connecting to:", wsUrl.replace(token, "TOKEN_HIDDEN"));

        // Prepare AudioContexts — reuse outputAudioContext if already primed
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
        if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
        // outputAudioContext was already created & resumed by primeOutputAudio()
        // but create it now if not pre-primed (e.g. reconnect flow)
        if (!this.outputAudioContext || this.outputAudioContext.state === 'closed') {
            this.createOutputAudioContext();
        }
        await this.outputAudioReadyPromise;
        await this.resumeOutputAudio();

        // Open WebSocket
        return new Promise((resolve, reject) => {
            this.webSocket = new WebSocket(wsUrl);

            this.webSocket.onopen = () => {
                console.log("WebSocket open");
                this.connected = true;
                this.session = true; // compatibility flag

                // Send setup message (official reference pattern)
                const toolDecls = [extractUnfamiliarEnglishToolDecl];
                const setupMessage = {
                    setup: {
                        model: `models/${MODEL}`,
                        generationConfig: {
                            responseModalities: ["AUDIO"],
                            speechConfig: {
                                voiceConfig: {
                                    prebuiltVoiceConfig: { voiceName: "Kore" },
                                },
                            },
                        },
                        systemInstruction: {
                            parts: [{ text: systemInstruction }],
                        },
                        tools: [
                            { functionDeclarations: toolDecls },
                        ],
                        inputAudioTranscription: {},
                        outputAudioTranscription: {},
                        realtimeInputConfig: {
                            automaticActivityDetection: {
                                disabled: false,
                            },
                            activityHandling: "ACTIVITY_HANDLING_UNSPECIFIED",
                            turnCoverage: "TURN_INCLUDES_ONLY_ACTIVITY",
                        },
                    },
                };
                console.log("Sending setup:", JSON.stringify(setupMessage).slice(0, 500));
                this.webSocket.send(JSON.stringify(setupMessage));
            };

            this.webSocket.onmessage = async (event) => {
                let jsonData;
                if (event.data instanceof Blob) {
                    jsonData = await event.data.text();
                } else {
                    jsonData = event.data;
                }

                try {
                    const msg = JSON.parse(jsonData);
                    await this.handleServerMessage(msg);

                    // After setup complete, start mic & signal connected
                    if (msg.setupComplete) {
                        console.log("Setup complete — starting mic");
                        this.config.onConnectionUpdate(true);
                        await this.startMic();
                        resolve();
                    }
                } catch (err) {
                    console.error("Error parsing server message:", err, jsonData);
                }
            };

            this.webSocket.onclose = (event) => {
                console.log("WebSocket closed", "code:", event.code, "reason:", event.reason, "wasClean:", event.wasClean);
                this.connected = false;
                this.session = null;
                this.disconnect();
            };

            this.webSocket.onerror = (event) => {
                console.error("WebSocket error:", event);
                this.config.onError("WebSocket connection error");
                this.connected = false;
                this.session = null;
                reject(new Error("WebSocket error"));
            };
        });
    }

    // ─── Microphone ────────────────────────────────────────────────────

    async startMic() {
        if (!this.inputAudioContext) return;
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (this.inputAudioContext.state === 'closed') return;

            this.mediaSource = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
            this.scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

            this.scriptProcessor.onaudioprocess = (e) => {
                if (this.isMuted || !this.connected) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const pcm16 = this.float32ToPcm16Base64(inputData);

                try {
                    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
                        const message = {
                            realtimeInput: {
                                audio: {
                                    data: pcm16,
                                    mimeType: "audio/pcm;rate=16000",
                                },
                            },
                        };
                        this.webSocket.send(JSON.stringify(message));
                    }
                } catch (err) {
                    // Ignore send errors during shutdown
                }
            };

            this.mediaSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(this.inputAudioContext.destination);
        } catch (e) {
            console.error("Mic Error", e);
            this.config.onError("Could not access microphone.");
        }
    }

    // ─── Server message handling ───────────────────────────────────────

    async handleServerMessage(message) {
        const serverContent = message.serverContent;

        // Gemini explicitly asks clients to stop and empty playback on an
        // interruption. Invalidate queued async work before reading new parts.
        if (serverContent?.interrupted) {
            this.invalidatePlayback();
            this.config.onMessage("", true, 'model');
        }

        // Audio Output
        const audioParts = (serverContent?.modelTurn?.parts || [])
            .map((part) => part?.inlineData)
            .filter((inlineData) => {
                if (!inlineData?.data) return false;
                return !inlineData.mimeType || inlineData.mimeType.startsWith('audio/');
            });
        if (audioParts.length > 0) {
            const playbackEpoch = this.playbackEpoch;
            // Chain playback work so async AudioContext resumes cannot reorder
            // rapidly arriving Gemini chunks.
            this.audioPlaybackChain = this.audioPlaybackChain
                .then(() => this.playAudioParts(audioParts, playbackEpoch))
                .catch((error) => {
                    console.error("Audio playback error:", error);
                    this.config.onPlaybackError?.("Audio playback was blocked. Reconnect to resume sound.");
                });
            await this.audioPlaybackChain;
        }

        // Output Transcription (AI Text)
        if (serverContent?.outputTranscription?.text) {
            this.config.onMessage(serverContent.outputTranscription.text, false, 'model');
        }

        // Input Transcription (User Text)
        if (serverContent?.inputTranscription?.text) {
            this.config.onMessage(serverContent.inputTranscription.text, false, 'user');
        }

        // Turn complete
        if (serverContent?.turnComplete) {
            this.config.onMessage("", true, 'model');
            this.config.onMessage("", true, 'user');
        }

        // Tool Call Handling
        if (message.toolCall) {
            console.log("Tool call received:", message.toolCall);
            const toolCalls = message.toolCall?.functionCalls;
            if (toolCalls && toolCalls.length > 0) {
                for (const call of toolCalls) {
                    if (call.name === 'extract_unfamiliar_english') {
                        await this.handleExtractUnfamiliarEnglish(call.args, call.id);
                    }
                }
            }
        }
    }

    async handleExtractUnfamiliarEnglish(args, callId) {
        console.log('Tool: extract_unfamiliar_english', args);

        // Respond to tool call immediately
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            const toolResponse = {
                toolResponse: {
                    functionResponses: [{
                        name: 'extract_unfamiliar_english',
                        id: callId,
                        response: { result: "saved" }
                    }]
                }
            };
            this.webSocket.send(JSON.stringify(toolResponse));
        }

        // Fire-and-forget: save to backend. Only celebrate when the server
        // actually persisted new items (skip empty-items no-ops).
        const hasItems = Array.isArray(args.items) && args.items.length > 0;
        fetch('/api/learning/unfamiliar-english', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: args.items,
                context: args.context,
                timestamp: new Date().toISOString(),
                userMessage: args.userMessage ?? null,
            }),
        })
            .then(res => {
                if (res.ok && hasItems) fireTinyConfetti();
            })
            .catch(e => console.error('Error saving unfamiliar english:', e));
    }

    // ─── Send text ─────────────────────────────────────────────────────

    async sendText(text) {
        if (!this.connected || !this.webSocket) return;

        // Optimistically update UI
        this.config.onMessage(text, true, 'user');

        // Use realtimeInput.text — same as official reference
        const message = {
            realtimeInput: {
                text: text,
            },
        };
        this.webSocket.send(JSON.stringify(message));
    }

    async sendContextMessage(text) {
        if (!this.connected || !this.webSocket) return;

        // Use realtimeInput.text — same as official reference
        const message = {
            realtimeInput: {
                text: text,
            },
        };
        this.webSocket.send(JSON.stringify(message));
    }

    // ─── Disconnect ────────────────────────────────────────────────────

    disconnect() {
        if (this.scriptProcessor) {
            this.scriptProcessor.disconnect();
            this.scriptProcessor = null;
        }
        if (this.mediaSource) {
            this.mediaSource.disconnect();
            this.mediaSource = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
            this.mediaStream = null;
        }
        this.invalidatePlayback();
        this.nextStartTime = 0;
        if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
            this.inputAudioContext.close();
        }
        if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
            this.outputAudioContext.close();
        }
        this.inputAudioContext = null;
        this.outputAudioContext = null;
        this.outputGainNode = null;
        this.outputAudioReadyPromise = null;
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            this.webSocket.close();
        }
        this.webSocket = null;
        this.connected = false;
        this.session = null;
        this.config.onConnectionUpdate(false);
    }

    // ─── Audio helpers ─────────────────────────────────────────────────

    async playAudioParts(audioParts, playbackEpoch = this.playbackEpoch) {
        if (playbackEpoch !== this.playbackEpoch) return;
        if (!this.outputAudioContext || this.outputAudioContext.state === 'closed') {
            this.createOutputAudioContext();
        }

        const context = this.outputAudioContext;
        await this.outputAudioReadyPromise;
        if (playbackEpoch !== this.playbackEpoch || context !== this.outputAudioContext) return;
        await this.resumeOutputAudio();
        if (playbackEpoch !== this.playbackEpoch || context !== this.outputAudioContext) return;

        if (!context || context.state !== 'running') {
            throw new Error(`Output AudioContext is ${context?.state || 'unavailable'}`);
        }

        for (const inlineData of audioParts) {
            if (playbackEpoch !== this.playbackEpoch || context !== this.outputAudioContext) return;
            const audioBuffer = this.decodeAudioFromBase64(inlineData.data);
            if (!audioBuffer) continue;

            const source = context.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputGainNode || context.destination);

            const earliestStart = context.currentTime + PLAYBACK_LEAD_TIME_SECONDS;
            this.nextStartTime = Math.max(this.nextStartTime, earliestStart);
            if (playbackEpoch !== this.playbackEpoch || context !== this.outputAudioContext) return;
            source.start(this.nextStartTime);
            this.nextStartTime += audioBuffer.duration;
            source.addEventListener('ended', () => this.sources.delete(source));
            this.sources.add(source);
        }
    }

    float32ToPcm16Base64(float32Array) {
        const pcm16 = new Int16Array(float32Array.length);
        for (let i = 0; i < float32Array.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Array[i]));
            pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    decodeAudioFromBase64(base64) {
        try {
            // Gemini returns raw PCM16 little-endian at 24kHz
            const binaryString = window.atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }

            // Convert PCM16 (Int16) → Float32
            const pcm16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(pcm16.length);
            for (let i = 0; i < pcm16.length; i++) {
                float32[i] = pcm16[i] / 32768;
            }

            // Create AudioBuffer (mono, 24kHz)
            const audioBuffer = this.outputAudioContext.createBuffer(1, float32.length, OUTPUT_SAMPLE_RATE);
            audioBuffer.getChannelData(0).set(float32);
            return audioBuffer;
        } catch (err) {
            console.error("Audio decode error:", err);
            return null;
        }
    }
}
