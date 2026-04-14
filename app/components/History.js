'use client';
import { useEffect, useState, useRef } from 'react';
import { useLanguage } from '@/app/contexts/LanguageContext';

import { TextMessage } from './TextMessage';
import { FunctionCallMessage } from './FunctionCallMessage';

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
            disconnect: 'Disconnect',
            mute: 'Mute',
            unmute: 'Unmute',
            placeholder: 'Type your message...',
            send: 'Send',
        },
        zh: {
            connect: '连接',
            connecting: '连接中...',
            disconnect: '断开',
            mute: '静音',
            unmute: '取消静音',
            placeholder: '输入你的消息...',
            send: '发送',
        },
        ja: {
            connect: '接続',
            connecting: '接続中...',
            disconnect: '切断',
            mute: 'ミュート',
            unmute: 'ミュート解除',
            placeholder: 'メッセージを入力...',
            send: '送信',
        },
    }[langCode];
    // Avoid hydration mismatches when layout changes between server and client
    const [mounted, setMounted] = useState(false);
    const containerRef = useRef(null);
    const [inputMessage, setInputMessage] = useState('');
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
        <div className="flex flex-col h-full min-h-0 text-foreground">
            <div
                className="overflow-y-auto custom-scroll px-4 flex-1 rounded-lg bg-card text-card-foreground space-y-4 min-h-0 border border-border pt-3 pb-8 sm:pb-10 md:pb-12"
                id="chatHistory"
                ref={containerRef}
            >
                {visibleHistory.map((item) => {

                    if (item.type === 'function_call') {
                        return <FunctionCallMessage message={item} key={item.itemId} />;
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
            <div className="flex gap-1 mt-2 items-center">
                <button
                    data-tour="connect-btn"
                    onClick={() => !isConnecting && connect()}
                    disabled={isConnecting}
                    className={`${isInputFocused ? 'hidden sm:flex' : 'flex'} w-10 h-10 lg:w-auto lg:px-4 rounded-full lg:rounded-lg font-medium transition-colors items-center justify-center text-lg flex-shrink-0 ${isConnected
                        ? 'bg-destructive text-white hover:bg-destructive/90'
                        : isConnecting
                            ? 'bg-primary/50 text-primary-foreground cursor-wait'
                            : 'bg-primary text-primary-foreground hover:bg-primary/90'
                        }`}
                    title={isConnected ? t.disconnect : isConnecting ? t.connecting : t.connect}
                >
                    <span className={`lg:hidden ${isConnecting ? 'opacity-50 grayscale' : ''}`}>
                        {isConnected ? "🌐" : "📶"}
                    </span>
                    <span className="hidden lg:inline">
                        {isConnected ? t.disconnect : isConnecting ? t.connecting : t.connect}
                    </span>
                </button>

                <button
                    onClick={toggleMute}
                    className={`${isInputFocused ? 'hidden sm:flex' : 'flex'} w-10 h-10 lg:w-auto lg:px-4 rounded-full lg:rounded-lg font-medium transition-colors items-center justify-center text-lg flex-shrink-0 ${isMuted
                        ? 'bg-destructive text-white hover:bg-destructive/90'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                        }`}
                    title={isMuted ? t.unmute : t.mute}
                >
                    <span className="lg:hidden">{isMuted ? "🔇" : "🎤"}</span>
                    <span className="hidden lg:inline">{isMuted ? t.unmute : t.mute}</span>
                </button>

                <input
                    type="text"
                    value={inputMessage}
                    onChange={(e) => setInputMessage(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing && inputMessage.trim()) {
                            e.preventDefault();
                            sendTextMessage(inputMessage.trim());
                            setInputMessage('');
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
                    onClick={() => {
                        if (inputMessage.trim()) {
                            sendTextMessage(inputMessage.trim());
                            setInputMessage('');
                        }
                    }}
                    disabled={!inputMessage.trim()}
                    className="px-4 py-2 rounded-lg font-medium transition-colors flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {t.send}
                </button>
            </div>
        </div>
    );
}
