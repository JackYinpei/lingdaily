'use client';
import { submitTextDraft } from '@/app/talk/_lib/textSubmission';
import { useEffect, useState, useRef } from 'react';
import { useLanguage } from '@/app/contexts/LanguageContext';

import { TextMessage } from './TextMessage';
import { CorrectionCard } from './CorrectionCard';
import { AudioLines, LoaderCircle, Mic, MicOff, Phone, PhoneOff, Send } from 'lucide-react';

export function History({
    isConnected,
    isConnecting,
    isMuted,
    toggleMute,
    connect,
    history,
    sendTextMessage,
    onInputFocus,
    onInputBlur,
}) {
    const { nativeLanguage } = useLanguage();
    const langCode = (nativeLanguage?.code || 'en').toLowerCase().startsWith('zh')
        ? 'zh'
        : (nativeLanguage?.code || 'en').toLowerCase().startsWith('ja')
            ? 'ja'
            : 'en';

    const t = {
        en: {
            connect: 'Connect',
            connecting: 'Connecting...',
            cancel: 'Cancel',
            disconnect: 'Disconnect',
            mute: 'Mute',
            unmute: 'Unmute',
            placeholder: 'Type your message...',
            send: 'Send',
            studio: 'Conversation', ready: 'Ready when you are', live: 'Live conversation', emptyTitle: 'A conversation starts with you.', emptyDescription: 'Choose a topic on the left, then connect to speak. You can also start by typing a message.',
        },
        zh: {
            connect: '连接',
            connecting: '连接中...',
            cancel: '取消',
            disconnect: '断开',
            mute: '静音',
            unmute: '取消静音',
            placeholder: '输入你的消息...',
            send: '发送',
            studio: '对话练习', ready: '准备好，就开口', live: '正在对话', emptyTitle: '想说的话，从这里开始。', emptyDescription: '选一个话题，连接后就可以开口。也可以先打字，慢慢找到表达的感觉。',
        },
        ja: {
            connect: '接続',
            connecting: '接続中...',
            cancel: 'キャンセル',
            disconnect: '切断',
            mute: 'ミュート',
            unmute: 'ミュート解除',
            placeholder: 'メッセージを入力...',
            send: '送信',
            studio: '会話練習', ready: '準備ができたら始めよう', live: '会話中', emptyTitle: 'あなたの言葉で、話そう。', emptyDescription: '話題を選んで接続すると話せます。メッセージを入力して始めることもできます。',
        },
    }[langCode];
    // Avoid hydration mismatches when layout changes between server and client
    const [mounted, setMounted] = useState(false);
    const containerRef = useRef(null);
    const [inputMessage, setInputMessage] = useState('');
    const submittingRef = useRef(false);
    const composingRef = useRef(false);
    const submitMessage = async () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        try {
            await submitTextDraft({
                draft: inputMessage,
                sendTextMessage,
                isComposing: composingRef.current,
                onAccepted: () => setInputMessage(current => current === inputMessage ? '' : current),
            });
        } finally {
            submittingRef.current = false;
        }
    };
    const [isInputFocused, setIsInputFocused] = useState(false);
    useEffect(() => setMounted(true), []);

    // Auto-scroll to bottom when history updates (covers AI subtitles and STT updates)
    useEffect(() => {
        if (!mounted) return;
        const el = containerRef.current;
        if (!el) return;
        // Ensure scroll runs after DOM updates
        const id = requestAnimationFrame(() => {
            try {
                el.scrollTop = el.scrollHeight;
            } catch { }
        });
        return () => cancelAnimationFrame(id);
    }, [history, mounted]);
    const visibleHistory = history.filter((item) => item.role !== 'system');

    return (
        <div className="feature-chat flex flex-col h-full min-h-0 text-foreground">
            <div className="feature-chat-heading"><span><AudioLines size={16} aria-hidden="true" />{t.studio}</span><span className="feature-chat-status">{isConnected ? t.live : isConnecting ? t.connecting : t.ready}</span></div>
            <div
                className="overflow-y-auto custom-scroll px-5 flex-1 text-card-foreground space-y-4 min-h-0 pt-3 pb-8"
                id="chatHistory"
                ref={containerRef}
            >
                {visibleHistory.length === 0 && <div className="feature-chat-empty"><AudioLines aria-hidden="true" /><h2>{t.emptyTitle}</h2><p>{t.emptyDescription}</p></div>}
                {visibleHistory.map((item) => {

                    if (item.type === 'correction') {
                        return <CorrectionCard correction={item.correction} key={item.itemId} />;
                    }

                    if (item.type === 'message') {
                        return (
                            <TextMessage
                                text={
                                    item.content.length > 0
                                        ? item.content
                                            .map((content) => {
                                                if (
                                                    content.type === 'output_text' ||
                                                    content.type === 'input_text'
                                                ) {
                                                    return content.text;
                                                }
                                                if (
                                                    content.type === 'input_audio' ||
                                                    content.type === 'output_audio'
                                                ) {
                                                    return content.transcript ?? '⚫︎⚫︎⚫︎';
                                                }
                                                return '';
                                            })
                                            .join('\n')
                                        : '⚫︎⚫︎⚫︎'
                                }
                                isUser={item.role === 'user'}
                                key={item.itemId}
                            />
                        );
                    }

                    return null;
                })}
            </div>
            <div className="feature-composer flex gap-2 items-center">
                <button
                    data-tour="connect-btn"
                    onClick={connect}
                    className={`flex w-10 h-10 lg:w-auto lg:px-4 rounded-full lg:rounded-lg font-medium transition-colors items-center justify-center text-lg flex-shrink-0 ${isConnected
                        ? 'bg-destructive text-white hover:bg-destructive/90'
                        : 'feature-connect-action'
                        }`}
                    title={isConnected ? t.disconnect : isConnecting ? t.cancel : t.connect}
                    aria-label={isConnected ? t.disconnect : isConnecting ? t.cancel : t.connect}
                >
                    {isConnected ? <PhoneOff size={16} aria-hidden="true" /> : isConnecting ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Phone size={16} aria-hidden="true" />}
                    <span className="hidden xl:inline ml-2 text-xs">
                        {isConnected ? t.disconnect : isConnecting ? t.cancel : t.connect}
                    </span>
                </button>

                <button
                    onClick={toggleMute}
                    className={`${isInputFocused ? 'hidden sm:flex' : 'flex'} w-10 h-10 lg:w-auto lg:px-4 rounded-full lg:rounded-lg font-medium transition-colors items-center justify-center text-lg flex-shrink-0 ${isMuted
                        ? 'bg-destructive text-white hover:bg-destructive/90'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                        }`}
                    title={isMuted ? t.unmute : t.mute}
                    aria-label={isMuted ? t.unmute : t.mute}
                >
                    {isMuted ? <MicOff size={16} aria-hidden="true" /> : <Mic size={16} aria-hidden="true" />}
                </button>

                <input
                    type="text"
                    aria-label={t.placeholder}
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onCompositionStart={() => { composingRef.current = true; }}
                    onCompositionEnd={() => { composingRef.current = false; }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229 && !composingRef.current) {
                            e.preventDefault();
                            submitMessage();
                        }
                    }}
                    onFocus={() => {
                        setIsInputFocused(true);
                        if (onInputFocus) onInputFocus();
                    }}
                    onBlur={() => {
                        setIsInputFocused(false);
                        if (onInputBlur) onInputBlur();
                    }}
                    placeholder={t.placeholder}
                    className="flex-1 min-w-0 px-4 py-2 rounded-lg bg-background text-foreground border border-input outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
                />


                <button
                    onClick={submitMessage}
                    disabled={!inputMessage.trim() || isConnecting}
                    aria-label={t.send}
                    className="px-4 py-2 rounded-lg font-medium transition-colors flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Send size={16} aria-hidden="true" />
                </button>
            </div>
        </div>
    );
}
