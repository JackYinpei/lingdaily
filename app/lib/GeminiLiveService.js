import { GoogleGenAI, Modality, Type } from "@google/genai";
import { base64ToBytes, decodeAudioData, createPcmBlob } from "./audioUtils";

export const extractUnfamiliarEnglishToolDecl = {
    name: "extract_unfamiliar_english",
    description: "Aggressive MODE: Call this tool AGGRESSIVELY whenever the above history contains ANY English (full sentence, a single word, code comments, or CN-EN mixed). Even if the user does NOT explicitly ask about a word, scan for potentially unfamiliar vocabulary, phrases, collocations, idioms, phrasal verbs, or grammar patterns",
    parameters: {
        type: Type.OBJECT,
        properties: {
            userMessage: {
                type: Type.STRING,
                description: "The user's original message that was analyzed"
            },
            items: {
                type: Type.ARRAY,
                description: "List of unfamiliar or interesting elements identified from user input",
                items: {
                    type: Type.OBJECT,
                    properties: {
                        text: {
                            type: Type.STRING,
                            description: "The exact word, phrase, or grammar pattern the user is unsure about or curious about"
                        },
                        type: {
                            type: Type.STRING,
                            enum: ["word", "phrase", "grammar", "other"],
                            description: "The category of the unfamiliar element"
                        }
                    },
                    required: ["text", "type"]
                }
            },
            context: {
                type: Type.STRING,
                description: "Additional context about the conversation or user level if known"
            }
        },
        required: ["userMessage", "items"]
    }
};

export class GeminiLiveServiceImpl {
    constructor(config) {
        this.session = null;
        this.inputAudioContext = null;
        this.outputAudioContext = null;
        this.nextStartTime = 0;
        this.mediaStream = null;
        this.sources = new Set();
        this.systemInstruction = "";
        this.isMuted = false;

        this.config = config;
        this.ai = null;
    }

    setMuted(muted) {
        this.isMuted = muted;
    }

    async connect(systemInstruction, token) {
        this.systemInstruction = systemInstruction;

        // Initialize AI client just before connection (using fresh token)
        const apiKey = token || this.config.apiKey;
        if (!apiKey) {
            this.config.onError("No API Key or Token provided");
            return;
        }

        this.ai = new GoogleGenAI({
            apiKey: apiKey,
            httpOptions: {
                baseUrl: process.env.NEXT_PUBLIC_GEMINI_BASE_URL,
                apiVersion: 'v1alpha'
            }
        });

        // Use standard window.AudioContext, with webkit fallback if necessary (mostly for older Safari, but standard is widely supported now)
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;

        this.inputAudioContext = new AudioContextClass({ sampleRate: 16000 });
        this.outputAudioContext = new AudioContextClass({ sampleRate: 24000 });

        // Resume AudioContexts if they are suspended (browser autoplay policy)
        if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
        if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();

        const toolsConfig = [{ functionDeclarations: [extractUnfamiliarEnglishToolDecl] }, { googleSearch: {} }];
        console.log("Gemini Live Connecting with tools:", toolsConfig);

        const sessionPromise = this.ai.live.connect({
            model: 'gemini-3.1-flash-live-preview',
            callbacks: {
                onopen: async () => {
                    this.config.onConnectionUpdate(true);
                    await this.startMic(sessionPromise);
                },
                onmessage: async (message) => {
                    this.handleServerMessage(message);
                },
                onclose: () => {
                    console.log("Session closed");
                    this.disconnect();
                },
                onerror: (e) => {
                    console.error("Session Error:", e);
                    this.config.onError("Session Error: " + (e.message || "Unknown error"));
                    this.disconnect();
                }
            },
            config: {
                responseModalities: [Modality.AUDIO],
                systemInstruction: { parts: [{ text: systemInstruction }] },
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
                },
                tools: toolsConfig,
                outputAudioTranscription: {},
                inputAudioTranscription: {},
                thinkingConfig: {
                    thinkingBudget: 1024,
                },
            },
        });

        // Wait for connection to establish before assigning session
        this.session = await sessionPromise;
    }

    async startMic(sessionPromise) {
        if (!this.inputAudioContext) return;

        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

            if (this.inputAudioContext.state === 'closed') return;

            const source = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
            const scriptProcessor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);

            scriptProcessor.onaudioprocess = (e) => {
                if (this.isMuted || !this.session) return; // Skip processing if muted or not connected
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createPcmBlob(inputData);

                try {
                    const result = this.session.sendRealtimeInput({ media: pcmBlob });
                    // Handle async errors if it returns a promise to suppress "WebSocket closed" errors
                    if (result && typeof result.then === 'function') {
                        result.catch(() => { });
                    }
                } catch (err) {
                    // Ignore specific sending errors during shutdown
                }
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(this.inputAudioContext.destination);
        } catch (e) {
            console.error("Mic Error", e);
            this.config.onError("Could not access microphone.");
        }
    }

    async handleServerMessage(message) {
        const isAudioMessage = message.serverContent?.modelTurn?.parts?.some(part => part.inlineData?.mimeType?.startsWith('audio/pcm'));
        const isSystemMessage = message.setupComplete || message.sessionResumptionUpdate;

        if (!isAudioMessage && !isSystemMessage) {
            console.log("SERVER MESSAGE:", JSON.stringify(message, null, 2));
        }
        // Audio Output
        const audioData = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
        if (audioData && this.outputAudioContext) {
            this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
            const audioBuffer = await decodeAudioData(base64ToBytes(audioData), this.outputAudioContext);
            const source = this.outputAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.outputAudioContext.destination);
            source.start(this.nextStartTime);
            this.nextStartTime += audioBuffer.duration;

            source.addEventListener('ended', () => {
                this.sources.delete(source);
            });
            this.sources.add(source);
        }

        // Output Transcription (AI Text)
        if (message.serverContent?.outputTranscription?.text) {
            this.config.onMessage(message.serverContent.outputTranscription.text, false, 'model');
        }

        // Input Transcription (User Text)
        if (message.serverContent?.inputTranscription?.text) {
            this.config.onMessage(message.serverContent.inputTranscription.text, false, 'user');
        }

        if (message.serverContent?.turnComplete) {
            this.config.onMessage("", true, 'model');
            this.config.onMessage("", true, 'user');
        }

        if (message.serverContent?.interrupted) {
            this.sources.forEach(s => s.stop());
            this.sources.clear();
            this.nextStartTime = 0;
            this.config.onMessage("", true, 'model');
        }

        // Tool Call Handling
        if (message.toolCall) {
            console.log("Gemini requested tool call:", message.toolCall);
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
        console.log('Gemini requested tool: extract_unfamiliar_english', args);

        // Respond to tool call immediately to unblock the model (3.1 is blocking)
        if (this.session) {
            await this.session.sendToolResponse({
                functionResponses: [{
                    name: 'extract_unfamiliar_english',
                    id: callId,
                    response: { result: "saved" }
                }]
            });
        }

        // Fire-and-forget: save to backend asynchronously
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

    async sendText(text) {
        if (this.session) {
            // Optimistically update UI
            this.config.onMessage(text, true, 'user');

            // Use sendClientContent for text input as per Gemini Live API docs
            // content: [{ parts: [{ text }] }] is for sendRealtimeInput which is mainly for media
            // sendClientContent is better for text turns
            this.session.sendClientContent({ turns: text, turnComplete: true });
        }
    }

    /**
     * Sends a context update (e.g. news content) to the model without displaying it in the user's chat UI.
     * This acts as a 'System' or 'Context' injection during the session.
     */
    async sendContextMessage(text) {
        if (this.session) {
            this.session.sendClientContent({ turns: text, turnComplete: true });
        }
    }

    disconnect() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(t => t.stop());
        }
        this.sources.forEach(s => s.stop());
        if (this.inputAudioContext && this.inputAudioContext.state !== 'closed') {
            this.inputAudioContext.close();
        }
        if (this.outputAudioContext && this.outputAudioContext.state !== 'closed') {
            this.outputAudioContext.close();
        }

        this.session = null;
        this.config.onConnectionUpdate(false);
    }
}
