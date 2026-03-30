/**
 * GeminiLiveService — Raw WebSocket implementation
 * Based on the official Google reference:
 * https://github.com/google-gemini/gemini-live-api-examples/tree/main/gemini-live-ephemeral-tokens-websocket
 */

// Tool declaration for extracting unfamiliar English
export const extractUnfamiliarEnglishToolDecl = {
    name: "extract_unfamiliar_english",
    description: "Aggressive MODE: Call this tool AGGRESSIVELY whenever the above history contains ANY English (full sentence, a single word, code comments, or CN-EN mixed). Even if the user does NOT explicitly ask about a word, scan for potentially unfamiliar vocabulary, phrases, collocations, idioms, phrasal verbs, or grammar patterns",
    parameters: {
        type: "OBJECT",
        properties: {
            userMessage: {
                type: "STRING",
                description: "The user's original message that was analyzed"
            },
            items: {
                type: "ARRAY",
                description: "List of unfamiliar or interesting elements identified from user input",
                items: {
                    type: "OBJECT",
                    properties: {
                        text: {
                            type: "STRING",
                            description: "The exact word, phrase, or grammar pattern the user is unsure about or curious about"
                        },
                        type: {
                            type: "STRING",
                            enum: ["word", "phrase", "grammar", "other"],
                            description: "The category of the unfamiliar element"
                        }
                    },
                    required: ["text", "type"]
                }
            },
            context: {
                type: "STRING",
                description: "Additional context about the conversation or user level if known"
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

        this.config = config;
    }

    setMuted(muted) {
        this.isMuted = muted;
    }

    /**
     * Call this synchronously in the button click handler BEFORE any await.
     * It creates and resumes the outputAudioContext while the browser still
     * considers this a user gesture, ensuring the first audio chunk plays.
     */
    primeOutputAudio() {
        if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.outputAudioContext = new AudioContextClass({ sampleRate: 24000 });
        // Call resume() synchronously (no await) — Chrome only needs the call
        // to happen during the gesture; we don't need to await completion here.
        this.outputAudioContext.resume();
        console.log("Output AudioContext primed, state:", this.outputAudioContext.state);
    }

    // ─── Connection ────────────────────────────────────────────────────

    async connect(systemInstruction, token) {
        this.systemInstruction = systemInstruction;

        if (!token) {
            this.config.onError("No ephemeral token provided");
            return;
        }

        // Build WebSocket URL — same as official reference
        const MODEL = "gemini-3.1-flash-live-preview";
        const wsUrl =
            `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${token}`;

        console.log("Connecting to:", wsUrl.replace(token, "TOKEN_HIDDEN"));

        // Prepare AudioContexts — reuse outputAudioContext if already primed
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
        if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
        // outputAudioContext was already created & resumed by primeOutputAudio()
        // but create it now if not pre-primed (e.g. reconnect flow)
        if (!this.outputAudioContext || this.outputAudioContext.state === 'closed') {
            this.outputAudioContext = new AudioContextClass({ sampleRate: 24000 });
        }
        if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();

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
                    this.handleServerMessage(msg);

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

        // Audio Output
        const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData && this.outputAudioContext) {
            // Resume output context if browser suspended it (autoplay policy)
            if (this.outputAudioContext.state === 'suspended') {
                await this.outputAudioContext.resume();
            }
            this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
            const audioBuffer = this.decodeAudioFromBase64(audioData);
            if (audioBuffer) {
                const source = this.outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(this.outputAudioContext.destination);
                source.start(this.nextStartTime);
                this.nextStartTime += audioBuffer.duration;
                source.addEventListener('ended', () => this.sources.delete(source));
                this.sources.add(source);
            }
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

        // Interrupted
        if (serverContent?.interrupted) {
            this.sources.forEach(s => s.stop());
            this.sources.clear();
            this.nextStartTime = 0;
            this.config.onMessage("", true, 'model');
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

        // Fire-and-forget: save to backend
        fetch('/api/learning/unfamiliar-english', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                items: args.items,
                context: args.context,
                timestamp: new Date().toISOString(),
                userMessage: args.userMessage ?? null,
            }),
        }).catch(e => console.error('Error saving unfamiliar english:', e));
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
        this.sources.forEach(s => { try { s.stop(); } catch (_) { } });
        this.sources.clear();
        if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
            this.inputAudioContext.close();
        }
        if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
            this.outputAudioContext.close();
        }
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
            this.webSocket.close();
        }
        this.webSocket = null;
        this.connected = false;
        this.session = null;
        this.config.onConnectionUpdate(false);
    }

    // ─── Audio helpers ─────────────────────────────────────────────────

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
            const audioBuffer = this.outputAudioContext.createBuffer(1, float32.length, 24000);
            audioBuffer.getChannelData(0).set(float32);
            return audioBuffer;
        } catch (err) {
            console.error("Audio decode error:", err);
            return null;
        }
    }
}
