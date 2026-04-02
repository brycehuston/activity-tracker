import React, { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { BookOpenText } from 'lucide-react';
import { Login } from './components/Login';
import { Dashboard } from './components/Dashboard';

// Create socket with autoConnect disabled so we can add listeners before connecting
const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
export const socket: Socket = io(API_URL, { autoConnect: false });

export type Platform = 'whatsapp' | 'signal';

export interface ConnectionState {
    whatsapp: boolean;
    signal: boolean;
    signalNumber: string | null;
    signalApiAvailable: boolean;
    signalQrImage: string | null;
    whatsappQr: string | null;
}

const WHATSAPP_QR_GRACE_MS = 15000;

function App() {
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;

        const saved = localStorage.getItem('theme');
        if (saved === 'dark' || saved === 'light') {
            return saved === 'dark';
        }

        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    });
    const [showHowItWorks, setShowHowItWorks] = useState(false);
    const [selectedPlatform, setSelectedPlatform] = useState<Platform>('whatsapp');
    const whatsappQrClearTimeoutRef = useRef<number | null>(null);
    const [connectionState, setConnectionState] = useState<ConnectionState>({
        whatsapp: false,
        signal: false,
        signalNumber: null,
        signalApiAvailable: false,
        signalQrImage: null,
        whatsappQr: null
    });

    const isAnyPlatformReady = connectionState.whatsapp || connectionState.signal;
    const shellClass = isDarkMode ? 'theme-dark text-slate-100' : 'theme-light text-slate-900';
    const frameClass = isDarkMode ? 'glass-dark' : 'glass-light';
    const heroTextClass = isDarkMode ? 'text-slate-300' : 'text-slate-700';
    const subtleTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-600';
    const actionButtonClass = isDarkMode
        ? 'border border-[#d2a757]/30 bg-white/[0.04] text-slate-100 hover:bg-white/[0.08]'
        : 'border border-[#a97d30]/45 bg-[#f7ecd9] text-[#3e2d0f] hover:bg-[#f2e2c4]';
    const platformButtonBase = 'inline-flex h-11 items-center justify-center rounded-full border px-4 text-[11px] font-semibold uppercase tracking-[0.08em] transition';
    const idlePlatformButtonClass = isDarkMode
        ? 'border-[#d2a757]/30 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08]'
        : 'border-[#a97d30]/38 bg-[#f7ecd9]/65 text-[#6d5a35] hover:bg-[#f2e2c4]';
    const selectedPlatformButtonClass = isDarkMode
        ? 'border-[#d2a757]/55 bg-[#d2a757]/14 text-[#f8dfad]'
        : 'border-[#b48836]/45 bg-[#ddb974]/24 text-[#5a3d0f]';
    const whatsappConnectedClass = isDarkMode
        ? 'border-emerald-400/60 bg-emerald-500/18 text-emerald-100 shadow-[0_0_20px_rgba(34,197,94,0.35)]'
        : 'border-emerald-500/55 bg-emerald-200 text-emerald-900 shadow-[0_0_14px_rgba(34,197,94,0.28)]';
    const signalConnectedClass = isDarkMode
        ? 'border-sky-400/58 bg-sky-500/16 text-sky-100 shadow-[0_0_20px_rgba(59,130,246,0.34)]'
        : 'border-sky-500/52 bg-sky-200 text-sky-900 shadow-[0_0_14px_rgba(59,130,246,0.28)]';

    useEffect(() => {
        function clearWhatsAppQrTimeout() {
            if (whatsappQrClearTimeoutRef.current !== null) {
                window.clearTimeout(whatsappQrClearTimeoutRef.current);
                whatsappQrClearTimeoutRef.current = null;
            }
        }

        function scheduleWhatsAppQrClear() {
            clearWhatsAppQrTimeout();
            whatsappQrClearTimeoutRef.current = window.setTimeout(() => {
                setConnectionState(prev => ({ ...prev, whatsappQr: null }));
                whatsappQrClearTimeoutRef.current = null;
            }, WHATSAPP_QR_GRACE_MS);
        }

        function onDisconnect() {
            scheduleWhatsAppQrClear();
            setConnectionState(prev => ({
                ...prev,
                whatsapp: false,
                signal: false,
                signalNumber: null,
                signalApiAvailable: false,
                signalQrImage: null
            }));
        }

        function onWhatsAppConnectionOpen() {
            clearWhatsAppQrTimeout();
            setConnectionState(prev => ({ ...prev, whatsapp: true, whatsappQr: null }));
        }

        function onWhatsAppConnectionClose() {
            scheduleWhatsAppQrClear();
            setConnectionState(prev => ({ ...prev, whatsapp: false }));
        }

        function onWhatsAppQr(qr: string) {
            console.log('[WHATSAPP] Received QR code');
            clearWhatsAppQrTimeout();
            setConnectionState(prev => ({ ...prev, whatsappQr: qr }));
        }

        function onSignalConnectionOpen(data: { number: string }) {
            setConnectionState(prev => ({
                ...prev,
                signal: true,
                signalNumber: data.number
            }));
        }

        function onSignalDisconnected() {
            setConnectionState(prev => ({
                ...prev,
                signal: false,
                signalNumber: null
            }));
        }

        function onSignalApiStatus(data: { available: boolean }) {
            setConnectionState(prev => ({ ...prev, signalApiAvailable: data.available }));
        }

        function onSignalQrImage(url: string) {
            console.log('[SIGNAL] Received QR image URL:', url);
            setConnectionState(prev => ({ ...prev, signalQrImage: url }));
        }

        socket.on('disconnect', onDisconnect);
        socket.on('qr', onWhatsAppQr);
        socket.on('connection-open', onWhatsAppConnectionOpen);
        socket.on('connection-close', onWhatsAppConnectionClose);
        socket.on('signal-connection-open', onSignalConnectionOpen);
        socket.on('signal-disconnected', onSignalDisconnected);
        socket.on('signal-api-status', onSignalApiStatus);
        socket.on('signal-qr-image', onSignalQrImage);

        if (!socket.connected) {
            socket.connect();
        }

        return () => {
            clearWhatsAppQrTimeout();
            socket.off('disconnect', onDisconnect);
            socket.off('qr', onWhatsAppQr);
            socket.off('connection-open', onWhatsAppConnectionOpen);
            socket.off('connection-close', onWhatsAppConnectionClose);
            socket.off('signal-connection-open', onSignalConnectionOpen);
            socket.off('signal-disconnected', onSignalDisconnected);
            socket.off('signal-api-status', onSignalApiStatus);
            socket.off('signal-qr-image', onSignalQrImage);
        };
    }, []);

    useEffect(() => {
        if (selectedPlatform === 'whatsapp' && !connectionState.whatsapp && connectionState.signal) {
            setSelectedPlatform('signal');
        } else if (selectedPlatform === 'signal' && !connectionState.signal && connectionState.whatsapp) {
            setSelectedPlatform('whatsapp');
        }
    }, [selectedPlatform, connectionState.whatsapp, connectionState.signal]);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleSystemThemeChange = (event: MediaQueryListEvent) => {
            const saved = localStorage.getItem('theme');
            if (saved === 'dark' || saved === 'light') return;
            setIsDarkMode(event.matches);
        };

        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleSystemThemeChange);
        } else if (typeof mediaQuery.addListener === 'function') {
            mediaQuery.addListener(handleSystemThemeChange);
        }

        return () => {
            if (typeof mediaQuery.removeEventListener === 'function') {
                mediaQuery.removeEventListener('change', handleSystemThemeChange);
            } else if (typeof mediaQuery.removeListener === 'function') {
                mediaQuery.removeListener(handleSystemThemeChange);
            }
        };
    }, []);

    useEffect(() => {
        if (typeof document === 'undefined') return;

        document.title = 'Huston Solutions | RTT Activity Tracker';
        document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light';

        const themeColorMeta = document.querySelector('meta[name="theme-color"]');
        if (themeColorMeta) {
            themeColorMeta.setAttribute('content', isDarkMode ? '#0b0a08' : '#e9ddcc');
        }
    }, [isDarkMode]);

    return (
        <div className={`app-shell flex min-h-screen flex-col ${shellClass}`}>
            <div className="relative z-10 mx-auto flex w-full max-w-[1360px] flex-1 flex-col px-4 pb-4 pt-4 sm:px-6 sm:pb-5 sm:pt-5 xl:px-8 xl:pb-6">
                <header className={`${frameClass} motion-fade-up mb-5 rounded-[28px] px-5 py-5 sm:px-7 sm:py-6`}>
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                        <div className="max-w-[640px] space-y-3">
                            <p className={`fine-copy text-[11px] ${subtleTextClass}`}>RTT Activity Tracker</p>
                            <h1 className="tech-display text-[clamp(1.72rem,2.6vw,2.9rem)] font-extrabold leading-none tracking-[-0.03em]">
                                HUSTON SOLUTIONS
                            </h1>
                            <p className={`max-w-[560px] text-sm leading-relaxed sm:text-[15px] ${heroTextClass}`}>
                                Linked-device monitoring for WhatsApp and Signal, with active RTT checks and passive activity review in one workspace.
                            </p>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 lg:max-w-[580px] lg:justify-end">
                            <button
                                onClick={() => setSelectedPlatform('whatsapp')}
                                className={`${platformButtonBase} ${
                                    connectionState.whatsapp
                                        ? whatsappConnectedClass
                                        : (selectedPlatform === 'whatsapp' ? selectedPlatformButtonClass : idlePlatformButtonClass)
                                }`}
                                aria-pressed={selectedPlatform === 'whatsapp'}
                            >
                                WhatsApp
                            </button>
                            <button
                                onClick={() => setSelectedPlatform('signal')}
                                className={`${platformButtonBase} ${
                                    connectionState.signal
                                        ? signalConnectedClass
                                        : (selectedPlatform === 'signal' ? selectedPlatformButtonClass : idlePlatformButtonClass)
                                }`}
                                aria-pressed={selectedPlatform === 'signal'}
                            >
                                Signal
                            </button>

                            <button
                                onClick={() => {
                                    setIsDarkMode(prev => {
                                        const next = !prev;
                                        localStorage.setItem('theme', next ? 'dark' : 'light');
                                        return next;
                                    });
                                }}
                                title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                                className={`theme-toggle mx-1 ${isDarkMode ? 'is-dark' : 'is-light'}`}
                            >
                                <span className="theme-toggle-icon">☀</span>
                                <span className="theme-toggle-icon">☾</span>
                                <span className="theme-toggle-knob" />
                            </button>

                            <button
                                onClick={() => setShowHowItWorks(true)}
                                title="How It Works"
                                className={`inline-flex h-11 items-center gap-1.5 rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${actionButtonClass}`}
                            >
                                <BookOpenText size={14} />
                                <span>How It Works</span>
                            </button>

                            {connectionState.whatsapp && (
                                <button
                                    onClick={() => socket.emit('logout-whatsapp')}
                                    title="Sign Out WhatsApp"
                                    className={`inline-flex h-11 items-center rounded-full px-4 text-[11px] font-semibold uppercase tracking-[0.08em] transition ${actionButtonClass}`}
                                >
                                    Sign Out WA
                                </button>
                            )}
                        </div>
                    </div>
                </header>

                <main className="motion-fade-up motion-delay-1 flex min-h-0 w-full flex-1 items-stretch pb-1">
                    {!isAnyPlatformReady ? (
                        <Login connectionState={connectionState} isDarkMode={isDarkMode} />
                    ) : (
                        <Dashboard
                            isDarkMode={isDarkMode}
                            selectedPlatform={selectedPlatform}
                        />
                    )}
                </main>
            </div>

            {/* How It Works Modal */}
            {showHowItWorks && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm sm:p-6">
                    <div className={`max-h-[min(86vh,780px)] w-full max-w-3xl overflow-y-auto rounded-[30px] p-5 shadow-2xl sm:p-7 ${frameClass}`}>
                        <div className="mb-5 flex items-start justify-between gap-4">
                            <div>
                                <p className={`fine-copy text-[10px] ${subtleTextClass}`}>System Briefing</p>
                                <h2 className="tech-display mt-2 text-xl sm:text-2xl">How Activity Is Inferred</h2>
                            </div>
                            <button
                                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${actionButtonClass}`}
                                onClick={() => setShowHowItWorks(false)}
                            >
                                Close
                            </button>
                        </div>
                        <div className={`space-y-5 text-sm leading-relaxed sm:text-[15px] ${heroTextClass}`}>
                            <p>In active mode this tool sends a tiny test and times the reply (RTT). In passive mode it sends nothing and only listens for visible activity events.</p>
                            <div className={`rounded-[24px] border p-4 sm:p-5 ${isDarkMode ? 'border-white/10 bg-black/15' : 'border-slate-300/55 bg-white/35'}`}>
                                <h3 className="tech-display mb-3 text-xs">The Easy Version</h3>
                                <div className="space-y-3">
                                    <div className={`border-t pt-3 ${isDarkMode ? 'border-white/10' : 'border-slate-300/55'}`}>
                                        <p className="font-semibold">1. We send a tiny check.</p>
                                        <p>The app sends a very small test action to the phone.</p>
                                    </div>
                                    <div className={`border-t pt-3 ${isDarkMode ? 'border-white/10' : 'border-slate-300/55'}`}>
                                        <p className="font-semibold">2. We time the reply.</p>
                                        <p>If the phone answers fast, it is usually awake and active.</p>
                                    </div>
                                    <div className={`border-t pt-3 ${isDarkMode ? 'border-white/10' : 'border-slate-300/55'}`}>
                                        <p className="font-semibold">3. We compare old and new speeds.</p>
                                        <p>Fast replies usually mean active. Slow replies usually mean idle. No reply can mean offline.</p>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h3 className="mb-2 font-semibold">What The Status Means</h3>
                                <p><strong>Likely Active</strong>: the phone is answering faster than normal.</p>
                                <p><strong>Likely Idle</strong>: the phone is answering slower than normal.</p>
                                <p><strong>Inconclusive</strong>: the signal is mixed, so the app is being careful.</p>
                                <p><strong>Offline</strong>: the phone did not answer the checks.</p>
                            </div>
                            <div>
                                <h3 className="mb-2 font-semibold">Controls</h3>
                                <p><strong>Active Delete Probe</strong> and <strong>Active Reaction Probe</strong> send checks and measure RTT directly.</p>
                                <p><strong>Passive Listen</strong> sends nothing and only reacts to visible incoming events.</p>
                                <p><strong>How It Works</strong> explains what can be inferred vs what cannot be observed directly.</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <footer className={`${isDarkMode ? 'border-[#d2a757]/22 bg-[#0b0a08]' : 'border-[#b48836]/28 bg-[#d9ccb5]'} motion-soft-reveal motion-delay-2 mt-auto border-t`}>
                <div className="mx-auto flex w-full max-w-[1360px] flex-col gap-2 px-4 py-4 text-center sm:flex-row sm:items-center sm:justify-between sm:px-6 xl:px-8">
                    <div className={`tech-display text-xs tracking-[0.18em] ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>
                        HUSTON SOLUTIONS Inc.
                    </div>
                    <div className={`text-[11px] uppercase tracking-[0.18em] ${subtleTextClass}`}>
                        WhatsApp + Signal telemetry workspace
                    </div>
                </div>
            </footer>
        </div>
    );
}

export default App;
