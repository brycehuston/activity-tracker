import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { ConnectionState } from '../App';

interface LoginProps {
    connectionState: ConnectionState;
    isDarkMode?: boolean;
}

export function Login({ connectionState, isDarkMode = false }: LoginProps) {
    const panelBaseClasses = `rounded-[30px] border p-5 sm:p-7 ${isDarkMode ? 'glass-dark' : 'glass-light'}`;
    const textPrimaryClass = isDarkMode ? 'text-slate-100' : 'text-slate-900';
    const textSecondaryClass = isDarkMode ? 'text-slate-300' : 'text-slate-600';
    const panelBgClass = isDarkMode ? 'border-white/10 bg-black/15' : 'border-slate-300/55 bg-white/45';
    const innerFrameClass = isDarkMode
        ? 'border border-white/10 bg-[#141518]'
        : 'border border-slate-300/60 bg-white/78';

    return (
        <div className="grid w-full grid-cols-1 items-stretch gap-5 xl:grid-cols-2">
            {/* WhatsApp Connection */}
            <div className={`${panelBaseClasses} motion-soft-reveal flex h-full min-h-[420px] flex-col overflow-hidden`}>
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <p className={`fine-copy text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Channel One</p>
                        <h2 className={`tech-display mt-2 text-[1.35rem] sm:text-[1.5rem] ${textPrimaryClass}`}>Connect WhatsApp</h2>
                        <p className={`mt-2 max-w-md text-sm leading-relaxed ${textSecondaryClass}`}>
                            Link one phone to start active RTT tracking and passive activity review for WhatsApp contacts.
                        </p>
                    </div>
                    {connectionState.whatsapp && (
                        <CheckCircle2 className={isDarkMode ? 'text-slate-200' : 'text-slate-700'} size={22} />
                    )}
                </div>
                {connectionState.whatsapp ? (
                    <div className={`flex min-h-[320px] flex-1 flex-col items-center justify-center rounded-[24px] border px-6 py-8 text-center ${panelBgClass}`}>
                        <CheckCircle2 size={44} className={isDarkMode ? 'text-slate-200' : 'text-slate-700'} />
                        <span className={`mt-4 text-lg font-semibold ${textPrimaryClass}`}>Connected</span>
                        <span className={`mt-1 max-w-xs text-sm leading-relaxed ${textSecondaryClass}`}>Secure lane established. New WhatsApp targets can be added from the dashboard immediately.</span>
                    </div>
                ) : (
                    <>
                        <div className={`mb-5 flex min-h-[320px] flex-1 items-center justify-center rounded-[24px] border p-4 sm:p-6 ${panelBgClass}`}>
                            {connectionState.whatsappQr ? (
                                <img
                                    src={connectionState.whatsappQr}
                                    alt="WhatsApp QR Code"
                                    className={`aspect-square w-full max-w-[288px] rounded-[24px] object-contain p-3 ${innerFrameClass}`}
                                />
                            ) : (
                                <div className={`flex aspect-square w-full max-w-[288px] items-center justify-center rounded-[24px] px-6 text-center text-sm leading-relaxed ${innerFrameClass} ${textSecondaryClass}`}>
                                    Waiting for QR Code...
                                </div>
                            )}
                        </div>
                        <p className={`${textSecondaryClass} mt-auto max-w-md text-sm leading-relaxed`}>
                            Open WhatsApp on your phone, go to Settings {'>'} Linked Devices, and scan the QR code to connect.
                        </p>
                    </>
                )}
            </div>

            {/* Signal Connection */}
            <div className={`${panelBaseClasses} motion-soft-reveal motion-delay-1 flex h-full min-h-[420px] flex-col overflow-hidden`}>
                <div className="mb-5 flex items-start justify-between gap-4">
                    <div>
                        <p className={`fine-copy text-[11px] ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Channel Two</p>
                        <h2 className={`tech-display mt-2 text-[1.35rem] sm:text-[1.5rem] ${textPrimaryClass}`}>Connect Signal</h2>
                        <p className={`mt-2 max-w-md text-sm leading-relaxed ${textSecondaryClass}`}>
                            Link Signal through the local API lane to monitor RTT movement and device-state changes from the same dashboard.
                        </p>
                    </div>
                    {connectionState.signal && (
                        <CheckCircle2 className={isDarkMode ? 'text-slate-200' : 'text-slate-700'} size={22} />
                    )}
                </div>
                {connectionState.signal ? (
                    <div className={`flex min-h-[320px] flex-1 flex-col items-center justify-center rounded-[24px] border px-6 py-8 text-center ${panelBgClass}`}>
                        <CheckCircle2 size={44} className={isDarkMode ? 'text-slate-200' : 'text-slate-700'} />
                        <span className={`mt-4 text-lg font-semibold ${textPrimaryClass}`}>Connected</span>
                        <span className={`mt-1 max-w-xs text-sm leading-relaxed ${textSecondaryClass}`}>{connectionState.signalNumber}</span>
                    </div>
                ) : connectionState.signalApiAvailable ? (
                    <>
                        <div className={`mb-5 flex min-h-[320px] flex-1 items-center justify-center rounded-[24px] border p-4 sm:p-6 ${panelBgClass}`}>
                            {connectionState.signalQrImage ? (
                                <img
                                    src={connectionState.signalQrImage}
                                    alt="Signal QR Code"
                                    className={`aspect-square w-full max-w-[288px] rounded-[24px] object-contain p-3 ${innerFrameClass}`}
                                />
                            ) : (
                                <div className={`flex aspect-square w-full max-w-[288px] items-center justify-center rounded-[24px] px-6 text-center text-sm leading-relaxed ${innerFrameClass} ${textSecondaryClass}`}>
                                    Waiting for QR Code...
                                </div>
                            )}
                        </div>
                        <p className={`${textSecondaryClass} mt-auto max-w-md text-sm leading-relaxed`}>
                            Open Signal on your phone, go to Settings {'>'} Linked Devices, and scan the QR code to connect.
                        </p>
                    </>
                ) : (
                    <>
                        <div className={`mb-5 flex min-h-[320px] flex-1 items-center justify-center rounded-[24px] border p-4 sm:p-6 ${panelBgClass}`}>
                            <div className={`flex aspect-square w-full max-w-[288px] flex-col items-center justify-center rounded-[24px] px-6 text-center ${innerFrameClass}`}>
                                <p className={`text-center text-sm font-semibold ${textPrimaryClass}`}>Signal API not available</p>
                                <p className={`mt-2 max-w-xs text-center text-xs leading-relaxed ${textSecondaryClass}`}>Run the `signal-cli-rest-api` container to enable this lane.</p>
                            </div>
                        </div>
                        <p className={`${textSecondaryClass} mt-auto max-w-md text-sm leading-relaxed`}>
                            Open Signal on your phone, go to Settings {'>'} Linked Devices, and scan the QR code to connect.
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
