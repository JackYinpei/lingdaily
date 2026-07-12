/**
 * GeminiLiveService — Raw WebSocket implementation
 * Based on the official Google reference:
 * https://github.com/google-gemini/gemini-live-api-examples/tree/main/gemini-live-ephemeral-tokens-websocket
 */
import confetti from 'canvas-confetti';
import { DEFAULT_LEARNING_LANGUAGE, DEFAULT_NATIVE_LANGUAGE } from '@/app/lib/languages';

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

const DEFAULT_LANGUAGE_PAIR = {
    learningLanguage: DEFAULT_LEARNING_LANGUAGE,
    nativeLanguage: DEFAULT_NATIVE_LANGUAGE,
};

function normalizeLanguagePair(pair = {}) {
    const learningLanguage = pair.learningLanguage || pair.targetLanguage || {};
    const nativeLanguage = pair.nativeLanguage || {};
    return {
        learningLanguage: {
            code: learningLanguage.code || DEFAULT_LANGUAGE_PAIR.learningLanguage.code,
            label: learningLanguage.label || DEFAULT_LANGUAGE_PAIR.learningLanguage.label,
        },
        nativeLanguage: {
            code: nativeLanguage.code || DEFAULT_LANGUAGE_PAIR.nativeLanguage.code,
            label: nativeLanguage.label || DEFAULT_LANGUAGE_PAIR.nativeLanguage.label,
        },
    };
}

// Build the declaration from the actual language pair selected by the user.
// Language codes are still validated by the backend; the model never chooses
// which vocabulary collection receives an item.
export function createLearningItemsToolDecl(pair) {
    const { learningLanguage, nativeLanguage } = normalizeLanguagePair(pair);
    const target = learningLanguage.label;
    const native = nativeLanguage.label;
    return {
        name: 'record_unfamiliar_learning_items',
        description: `Call this tool after a user message to record ${target} that the user genuinely does not know yet.

Only include an item when the user used ${native} instead of the needed ${target} expression, struggled or made an error while attempting it, explicitly asked what it means, or clearly mispronounced it. Do not record expressions the user used fluently and correctly. If no item qualifies, call the tool with an empty items array.`,
        parameters: {
            type: 'OBJECT',
            properties: {
                userMessage: {
                    type: 'STRING',
                    description: "The user's original message that was analyzed",
                },
                items: {
                    type: 'ARRAY',
                    description: `Specific ${target} learning items the user demonstrably struggled with. Empty when none qualify.`,
                    items: {
                        type: 'OBJECT',
                        properties: {
                            text: {
                                type: 'STRING',
                                description: `The correct ${target} word, phrase, or grammar form.`,
                            },
                            type: {
                                type: 'STRING',
                                enum: ['word', 'phrase', 'grammar', 'other'],
                                description: 'Category of the learning item',
                            },
                            meaning: {
                                type: 'STRING',
                                description: `A concise meaning or explanation in ${native}.`,
                            },
                            original: {
                                type: 'STRING',
                                description: `The user's original ${native} expression or incorrect attempt, when useful.`,
                            },
                        },
                        required: ['text', 'type'],
                    },
                },
                context: {
                    type: 'STRING',
                    description: `A brief ${native} note explaining why the item was flagged.`,
                },
            },
            required: ['userMessage', 'items'],
        },
    };
}

export const learningItemsToolDecl = createLearningItemsToolDecl(DEFAULT_LANGUAGE_PAIR);
// Keep the old export available for code/tests that imported it directly.
export const extractUnfamiliarEnglishToolDecl = {
    ...learningItemsToolDecl,
    name: 'extract_unfamiliar_english',
};

// Correction tool: after a user turn, the model may surface a single gentle,
// idiomatic rewrite of the user's target-language attempt. Purely advisory —
// the result is streamed to the UI and is not persisted.
export function createCorrectionToolDecl(pair) {
    const { learningLanguage, nativeLanguage } = normalizeLanguagePair(pair);
    const target = learningLanguage.label;
    const native = nativeLanguage.label;
    return {
        name: 'record_language_correction',
        description: `Call this tool when the user's ${target} can be improved, to offer ONE gentle, natural rewrite. Only call it when there is a genuine grammar, word-choice, or phrasing issue worth correcting — skip it when the user's ${target} is already fine. Do not call it more than once per user turn.`,
        parameters: {
            type: 'OBJECT',
            properties: {
                original: {
                    type: 'STRING',
                    description: `The user's original ${target} sentence or phrase that is being corrected.`,
                },
                corrected: {
                    type: 'STRING',
                    description: `The improved, natural ${target} version.`,
                },
                explanation: {
                    type: 'STRING',
                    description: `A concise ${native} explanation of what changed and why.`,
                },
                category: {
                    type: 'STRING',
                    enum: ['grammar', 'vocabulary', 'phrasing', 'other'],
                    description: 'The main kind of improvement.',
                },
            },
            required: ['original', 'corrected'],
        },
    };
}

export const correctionToolDecl = createCorrectionToolDecl(DEFAULT_LANGUAGE_PAIR);

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
        // Audio parts that arrived while the output context was not yet running.
        // Replayed by flushPendingAudio() once the context unlocks so the first
        // model turn is never silently dropped.
        this.pendingAudioParts = [];
        this.playbackEpoch = 0;
        this.connectionEpoch = 0;
        this.languagePair = normalizeLanguagePair();

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
        this.pendingAudioParts = [];
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

    isCurrentConnection(epoch, socket = null) {
        return epoch === this.connectionEpoch && (!socket || socket === this.webSocket);
    }

    stopInputAudio() {
        if (this.scriptProcessor) {
            try { this.scriptProcessor.disconnect(); } catch (_) { /* ignore */ }
            this.scriptProcessor = null;
        }
        if (this.mediaSource) {
            try { this.mediaSource.disconnect(); } catch (_) { /* ignore */ }
            this.mediaSource = null;
        }
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach((track) => track.stop());
            this.mediaStream = null;
        }
        if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
            try {
                Promise.resolve(this.inputAudioContext.close()).catch(() => undefined);
            } catch (_) { /* ignore */ }
        }
        this.inputAudioContext = null;
    }

    async waitForConnectionStep(promise, deadlineAt) {
        const remaining = deadlineAt - Date.now();
        if (remaining <= 0) throw new Error("Gemini Live setup timed out");
        let timeoutId;
        try {
            return await Promise.race([
                Promise.resolve(promise),
                new Promise((_, reject) => {
                    timeoutId = setTimeout(
                        () => reject(new Error("Gemini Live setup timed out")),
                        remaining,
                    );
                }),
            ]);
        } finally {
            if (timeoutId) clearTimeout(timeoutId);
        }
    }

    async connect(systemInstruction, token, languagePair = DEFAULT_LANGUAGE_PAIR) {
        this.systemInstruction = systemInstruction;
        const connectionPair = normalizeLanguagePair(languagePair);
        this.languagePair = connectionPair;
        this.invalidatePlayback();

        if (!token) {
            this.config.onError("No ephemeral token provided");
            return false;
        }

        // A reconnect must not orphan the previous microphone graph while the
        // output context remains primed by the current user gesture.
        this.stopInputAudio();

        // Supersede any socket that is still opening. Its event handlers retain
        // the previous epoch and therefore cannot mutate this new connection.
        const connectionEpoch = ++this.connectionEpoch;
        const connectionDeadline = Date.now() + 20000;
        const previousSocket = this.webSocket;
        this.webSocket = null;
        if (previousSocket && (previousSocket.readyState === 0 || previousSocket.readyState === 1)) {
            this.connected = false;
            this.session = null;
            try { previousSocket.close(); } catch (_) { /* ignore */ }
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
        const inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
        this.inputAudioContext = inputAudioContext;
        try {
            if (inputAudioContext.state === 'suspended') {
                await this.waitForConnectionStep(inputAudioContext.resume(), connectionDeadline);
            }
        } catch (connectionError) {
            if (this.isCurrentConnection(connectionEpoch)) {
                this.config.onError(connectionError.message);
                this.disconnect();
            }
            throw connectionError;
        }
        if (!this.isCurrentConnection(connectionEpoch)) {
            if (inputAudioContext.state !== 'closed') {
                try { inputAudioContext.close(); } catch (_) { /* ignore */ }
            }
            return false;
        }
        // outputAudioContext was already created & resumed by primeOutputAudio()
        // but create it now if not pre-primed (e.g. reconnect flow)
        if (!this.outputAudioContext || this.outputAudioContext.state === 'closed') {
            this.createOutputAudioContext();
        }
        try {
            await this.waitForConnectionStep(this.outputAudioReadyPromise, connectionDeadline);
            await this.waitForConnectionStep(this.resumeOutputAudio(), connectionDeadline);
        } catch (connectionError) {
            if (this.isCurrentConnection(connectionEpoch)) {
                this.config.onError(connectionError.message);
                this.disconnect();
            }
            throw connectionError;
        }
        if (!this.isCurrentConnection(connectionEpoch)) return false;

        // Open WebSocket
        return new Promise((resolve, reject) => {
            const socket = new WebSocket(wsUrl);
            this.webSocket = socket;
            let settled = false;
            let setupTimeout = null;
            const settleResolve = (value) => {
                if (settled) return;
                settled = true;
                if (setupTimeout) clearTimeout(setupTimeout);
                resolve(value);
            };
            const settleReject = (error) => {
                if (settled) return;
                settled = true;
                if (setupTimeout) clearTimeout(setupTimeout);
                reject(error);
            };
            setupTimeout = setTimeout(() => {
                if (!this.isCurrentConnection(connectionEpoch, socket)) {
                    settleResolve(false);
                    return;
                }
                const timeoutError = new Error("Gemini Live setup timed out");
                this.config.onError(timeoutError.message);
                settleReject(timeoutError);
                this.disconnect();
            }, Math.max(1, connectionDeadline - Date.now()));

            socket.onopen = () => {
                if (!this.isCurrentConnection(connectionEpoch, socket)) {
                    try { socket.close(); } catch (_) { /* ignore */ }
                    settleResolve(false);
                    return;
                }
                console.log("WebSocket open");
                this.connected = true;
                this.session = true; // compatibility flag

                // Send setup message (official reference pattern)
                const toolDecls = [
                    createLearningItemsToolDecl(connectionPair),
                    createCorrectionToolDecl(connectionPair),
                ];
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
                socket.send(JSON.stringify(setupMessage));
            };

            socket.onmessage = async (event) => {
                if (!this.isCurrentConnection(connectionEpoch, socket)) return;
                let jsonData;
                if (event.data instanceof Blob) {
                    jsonData = await event.data.text();
                } else {
                    jsonData = event.data;
                }
                if (!this.isCurrentConnection(connectionEpoch, socket)) return;

                try {
                    const msg = JSON.parse(jsonData);
                    await this.handleServerMessage(msg, connectionEpoch, socket);
                    if (!this.isCurrentConnection(connectionEpoch, socket)) {
                        settleResolve(false);
                        return;
                    }

                    // After setup complete, start mic & signal connected
                    if (msg.setupComplete) {
                        console.log("Setup complete — starting mic");
                        const micStarted = await this.startMic(connectionEpoch, socket);
                        if (!micStarted || !this.isCurrentConnection(connectionEpoch, socket)) {
                            settleResolve(false);
                            return;
                        }
                        this.config.onConnectionUpdate(true);
                        settleResolve(true);
                    }
                } catch (err) {
                    console.error("Error parsing server message:", err, jsonData);
                }
            };

            socket.onclose = (event) => {
                if (!this.isCurrentConnection(connectionEpoch, socket)) {
                    settleResolve(false);
                    return;
                }
                console.log("WebSocket closed", "code:", event.code, "reason:", event.reason, "wasClean:", event.wasClean);
                this.connected = false;
                this.session = null;
                this.disconnect();
                settleReject(new Error(event.reason || "WebSocket closed before setup completed"));
            };

            socket.onerror = (event) => {
                if (!this.isCurrentConnection(connectionEpoch, socket)) {
                    settleResolve(false);
                    return;
                }
                console.error("WebSocket error:", event);
                this.config.onError("WebSocket connection error");
                this.connected = false;
                this.session = null;
                this.disconnect();
                settleReject(new Error("WebSocket error"));
            };
        });
    }

    // ─── Microphone ────────────────────────────────────────────────────

    async startMic(connectionEpoch = this.connectionEpoch, socket = this.webSocket) {
        const inputAudioContext = this.inputAudioContext;
        if (!inputAudioContext || !this.isCurrentConnection(connectionEpoch, socket)) return false;
        try {
            const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (
                !this.isCurrentConnection(connectionEpoch, socket)
                || inputAudioContext !== this.inputAudioContext
                || inputAudioContext.state === 'closed'
            ) {
                mediaStream.getTracks().forEach((track) => track.stop());
                return false;
            }
            this.mediaStream = mediaStream;

            this.mediaSource = inputAudioContext.createMediaStreamSource(mediaStream);
            this.scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);

            this.scriptProcessor.onaudioprocess = (e) => {
                if (
                    this.isMuted
                    || !this.connected
                    || !this.isCurrentConnection(connectionEpoch, socket)
                ) return;
                const inputData = e.inputBuffer.getChannelData(0);
                const pcm16 = this.float32ToPcm16Base64(inputData);

                try {
                    if (socket.readyState === WebSocket.OPEN) {
                        const message = {
                            realtimeInput: {
                                audio: {
                                    data: pcm16,
                                    mimeType: "audio/pcm;rate=16000",
                                },
                            },
                        };
                        socket.send(JSON.stringify(message));
                    }
                } catch (err) {
                    // Ignore send errors during shutdown
                }
            };

            this.mediaSource.connect(this.scriptProcessor);
            this.scriptProcessor.connect(inputAudioContext.destination);
            // Acquiring the mic on the connect gesture can leave the OUTPUT
            // context suspended on some browsers, which is what silenced the
            // first model turn. Resume it now (still within the gesture) and
            // flush anything that was buffered while it was locked.
            this.resumeOutputAudio();
            return true;
        } catch (e) {
            if (!this.isCurrentConnection(connectionEpoch, socket)) return false;
            console.error("Mic Error", e);
            this.config.onError("Could not access microphone.");
            this.disconnect();
            return false;
        }
    }

    // ─── Server message handling ───────────────────────────────────────

    async handleServerMessage(message, connectionEpoch = this.connectionEpoch, socket = this.webSocket) {
        if (!this.isCurrentConnection(connectionEpoch, socket)) return;
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
            if (!this.isCurrentConnection(connectionEpoch, socket)) return;
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
                    if (
                        call.name === 'record_unfamiliar_learning_items'
                        || call.name === 'extract_unfamiliar_english'
                    ) {
                        await this.handleLearningItems(call.args, call.id, call.name);
                    } else if (call.name === 'record_language_correction') {
                        await this.handleCorrection(call.args, call.id, call.name);
                    }
                }
            }
        }
    }

    async handleLearningItems(args = {}, callId, callName = 'record_unfamiliar_learning_items') {
        const payload = args && typeof args === 'object' ? args : {};
        console.log(`Tool: ${callName}`, payload);

        // Acknowledge immediately so persistence latency never stalls the Live
        // session. The acknowledgement deliberately says "accepted" rather
        // than "saved" because the database write happens asynchronously.
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            const toolResponse = {
                toolResponse: {
                    functionResponses: [{
                        name: callName,
                        id: callId,
                        response: { result: "accepted" }
                    }]
                }
            };
            this.webSocket.send(JSON.stringify(toolResponse));
        }

        // Fire-and-forget: save to backend. Only celebrate when the server
        // actually persisted new items (skip empty-items no-ops).
        const hasItems = Array.isArray(payload.items) && payload.items.length > 0;
        fetch('/api/learning/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: Array.isArray(payload.items) ? payload.items : [],
                context: payload.context ?? null,
                timestamp: new Date().toISOString(),
                userMessage: payload.userMessage ?? null,
                learningLanguage: this.languagePair.learningLanguage.code,
                nativeLanguage: this.languagePair.nativeLanguage.code,
            }),
        })
            .then(async (res) => {
                const result = await res.json().catch(() => ({}));
                if (res.ok && result?.ok && !result?.skipped && hasItems) {
                    fireTinyConfetti();
                } else if (!res.ok) {
                    console.error('Learning items were not saved:', res.status);
                }
            })
            .catch(e => console.error('Error saving learning items:', e));
    }

    // Backward-compatible method for callers/tests that still use the old
    // English-specific name. New Live tool calls use handleLearningItems.
    async handleExtractUnfamiliarEnglish(args, callId) {
        return this.handleLearningItems(args, callId, 'extract_unfamiliar_english');
    }

    async handleCorrection(args = {}, callId, callName = 'record_language_correction') {
        const payload = args && typeof args === 'object' ? args : {};
        console.log(`Tool: ${callName}`, payload);

        // Acknowledge immediately so the Live session never stalls waiting on us.
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            const toolResponse = {
                toolResponse: {
                    functionResponses: [{
                        name: callName,
                        id: callId,
                        response: { result: 'accepted' },
                    }],
                },
            };
            this.webSocket.send(JSON.stringify(toolResponse));
        }

        const original = typeof payload.original === 'string' ? payload.original.trim() : '';
        const corrected = typeof payload.corrected === 'string' ? payload.corrected.trim() : '';
        // Nothing to show if the two are missing or identical.
        if (!original || !corrected || original === corrected) return;

        this.config.onCorrection?.({
            original,
            corrected,
            explanation: typeof payload.explanation === 'string' ? payload.explanation.trim() : '',
            category: typeof payload.category === 'string' ? payload.category : 'other',
        });
    }

    // ─── Send text ─────────────────────────────────────────────────────

    async sendText(text) {
        const socket = this.webSocket;
        if (!this.connected || !socket || socket.readyState !== WebSocket.OPEN) return;

        // Optimistically update UI
        this.config.onMessage(text, true, 'user');

        // Use realtimeInput.text — same as official reference
        const message = {
            realtimeInput: {
                text: text,
            },
        };
        socket.send(JSON.stringify(message));
    }

    async sendContextMessage(text) {
        const socket = this.webSocket;
        if (!this.connected || !socket || socket.readyState !== WebSocket.OPEN) return;

        // Use realtimeInput.text — same as official reference
        const message = {
            realtimeInput: {
                text: text,
            },
        };
        socket.send(JSON.stringify(message));
    }

    // ─── Disconnect ────────────────────────────────────────────────────

    disconnect() {
        // Invalidate handlers before closing so a late event from this socket
        // cannot tear down a subsequent connection.
        this.connectionEpoch += 1;
        const socket = this.webSocket;
        this.webSocket = null;
        if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
            try { socket.close(); } catch (_) { /* ignore */ }
        }
        this.stopInputAudio();
        this.invalidatePlayback();
        this.pendingAudioParts = [];
        this._pendingFlushContext = null;
        this.nextStartTime = 0;
        if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
            try {
                Promise.resolve(this.outputAudioContext.close()).catch(() => undefined);
            } catch (_) { /* ignore */ }
        }
        this.outputAudioContext = null;
        this.outputGainNode = null;
        this.outputAudioReadyPromise = null;
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

        // The context can still be 'suspended' here — most often for the very
        // first model turn, when autoplay unlock from the connect click has not
        // yet taken effect. Instead of dropping this audio (which made the first
        // reply silent until a later gesture), stash it and flush automatically
        // once the context reaches 'running'.
        if (!context || context.state !== 'running') {
            if (context && context.state === 'suspended') {
                this.queuePendingAudio(audioParts, playbackEpoch, context);
                return;
            }
            throw new Error(`Output AudioContext is ${context?.state || 'unavailable'}`);
        }

        this.scheduleAudioParts(audioParts, playbackEpoch, context);
    }

    // Buffer audio that arrived before the output context unlocked, and arrange
    // to replay it the instant the context resumes. Registered once per context;
    // repeated calls only append to the pending queue.
    queuePendingAudio(audioParts, playbackEpoch, context) {
        this.pendingAudioParts.push(...audioParts);

        if (this._pendingFlushContext === context) return;
        this._pendingFlushContext = context;

        const flush = () => {
            if (context.state !== 'running') {
                // Nudge again — a resume() may have been swallowed while locked.
                this.resumeOutputAudio();
                return;
            }
            context.removeEventListener('statechange', flush);
            if (this._pendingFlushContext === context) this._pendingFlushContext = null;
            if (playbackEpoch !== this.playbackEpoch || context !== this.outputAudioContext) {
                this.pendingAudioParts = [];
                return;
            }
            const queued = this.pendingAudioParts;
            this.pendingAudioParts = [];
            this.scheduleAudioParts(queued, playbackEpoch, context);
        };

        context.addEventListener('statechange', flush);
        // Also try immediately in case it flips to running between checks.
        this.resumeOutputAudio().then(flush);
    }

    scheduleAudioParts(audioParts, playbackEpoch, context) {
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
