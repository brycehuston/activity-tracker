import React, { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { socket, Platform } from '../App';
import { ContactCard } from './ContactCard';

type ProbeMethod = 'delete' | 'reaction' | 'passive';

interface DashboardProps {
    isDarkMode?: boolean;
    selectedPlatform: Platform;
}

interface TrackerData {
    rtt: number;
    avg: number;
    median: number;
    threshold: number;
    state: string;
    source?: 'phone' | 'desktop' | 'mixed' | 'unknown';
    confidence?: number;
    confidenceLabel?: string;
    timestamp: number;
}

interface DeviceInfo {
    jid: string;
    state: string;
    rtt: number;
    avg: number;
}

interface ActivityAnalytics {
    messageCount1h: number;
    messageCount24h: number;
    callCount1h: number;
    callCount24h: number;
    repeatedCallerFingerprint: string | null;
    repeatedCallerCount: number;
    topSourceFingerprint: string | null;
    topSourceEvents24h: number;
    lastInboundAt: number | null;
    lastCallAt: number | null;
}

interface ContactInfo {
    jid: string;
    displayNumber: string;
    contactName: string;
    data: TrackerData[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    platform: Platform;
    probeMode: 'active' | 'passive';
    analytics: ActivityAnalytics | null;
}

export function Dashboard({ isDarkMode = false, selectedPlatform }: DashboardProps) {
    const [inputNumber, setInputNumber] = useState('');
    const [contacts, setContacts] = useState<Map<string, ContactInfo>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [probeMethod, setProbeMethod] = useState<ProbeMethod>('delete');

    const panelBaseClass = isDarkMode ? 'glass-dark text-slate-100' : 'glass-light text-slate-900';
    const controlClass = isDarkMode
        ? 'border-white/10 bg-white/[0.03] text-slate-100'
        : 'border-slate-300/70 bg-white/55 text-slate-800';
    const helperTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
    const quietTextClass = isDarkMode ? 'text-slate-300' : 'text-slate-700';
    const selectedSegmentClass = isDarkMode
        ? 'border border-[#d2a757]/55 bg-[#d2a757]/18 text-[#f8dfad] shadow-[0_0_18px_rgba(210,167,87,0.2)]'
        : 'border border-[#b48836]/45 bg-[#ddb974]/26 text-[#6d4a14]';
    const selectedPlatformLabel = selectedPlatform === 'signal' ? 'Signal' : 'WhatsApp';

    function formatDisplayNumber(jid: string, platform: Platform) {
        if (platform === 'signal') {
            return jid.replace('signal:', '');
        }

        return jid.split('@')[0];
    }

    useEffect(() => {
        function onTrackerUpdate(update: any) {
            const { jid, ...data } = update;
            if (!jid) return;

            setContacts(prev => {
                const next = new Map(prev);
                const platform = (data.platform || 'whatsapp') as Platform;
                const contact = next.get(jid) || {
                    jid,
                    displayNumber: formatDisplayNumber(jid, platform),
                    contactName: formatDisplayNumber(jid, platform),
                    data: [],
                    devices: [],
                    deviceCount: 0,
                    presence: null,
                    profilePic: null,
                    platform,
                    probeMode: 'active' as const,
                    analytics: null
                };

                const derivedDevices: DeviceInfo[] = Array.isArray(data.devices) && data.devices.length > 0
                    ? data.devices
                    : data.lastRtt !== undefined || data.avgRtt !== undefined || data.state
                        ? [{
                            jid,
                            state: data.state || 'Calibrating...',
                            rtt: data.lastRtt ?? 0,
                            avg: data.avgRtt ?? data.lastRtt ?? 0
                        }]
                        : contact.devices;

                const updatedContact: ContactInfo = {
                    ...contact,
                    platform,
                    presence: data.presence !== undefined ? data.presence : contact.presence,
                    deviceCount: data.deviceCount !== undefined ? data.deviceCount : derivedDevices.length || contact.deviceCount,
                    devices: derivedDevices,
                    probeMode: data.probeMode === 'passive' ? 'passive' : 'active',
                    analytics: data.analytics || contact.analytics
                };

                if (data.probeMode === 'passive' && data.analytics) {
                    const activity1h = (data.analytics.messageCount1h || 0) + (data.analytics.callCount1h || 0) * 2;
                    const recentBoost = data.analytics.lastInboundAt && (Date.now() - data.analytics.lastInboundAt) < 90000 ? 2 : 0;
                    const eventScore = Math.max(1, activity1h + recentBoost);
                    const baseline = Math.max(1, Math.round(((data.analytics.messageCount24h || 0) + (data.analytics.callCount24h || 0) * 2) / 6));
                    const threshold = Math.max(1, baseline);
                    const previousAvg = contact.data.length > 0 ? contact.data[contact.data.length - 1].avg : eventScore;
                    const avg = Math.max(1, Math.round((previousAvg * 0.7) + (eventScore * 0.3)));
                    const passivePoint: TrackerData = {
                        rtt: eventScore,
                        avg,
                        median: baseline,
                        threshold,
                        state: data.state || 'Inconclusive',
                        source: data.source,
                        confidence: data.confidence,
                        confidenceLabel: data.confidenceLabel,
                        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now()
                    };
                    updatedContact.data = [...contact.data, passivePoint].slice(-100);
                    next.set(jid, updatedContact);
                    return next;
                }

                if (derivedDevices.length > 0) {
                    const primaryDevice = derivedDevices.find((device) => device.state.includes('Active'))
                        || derivedDevices.find((device) => device.state.includes('Online'))
                        || derivedDevices[0];
                    const rttValue = Number.isFinite(primaryDevice.rtt) ? primaryDevice.rtt : 0;
                    const avgValue = Number.isFinite(primaryDevice.avg) ? primaryDevice.avg : 0;
                    if (rttValue <= 0 && avgValue <= 0) {
                        next.set(jid, updatedContact);
                        return next;
                    }
                    const fallbackMedian = Math.max(1, Math.round(avgValue || rttValue || 1));
                    const medianValue = (data.median !== undefined && data.median > 0) ? data.median : fallbackMedian;
                    const threshold = data.threshold !== undefined
                        ? data.threshold
                        : Math.max(1, Math.round(medianValue * 0.9));
                    const newDataPoint: TrackerData = {
                        rtt: rttValue,
                        avg: avgValue,
                        median: medianValue,
                        threshold,
                        state: data.state || primaryDevice.state,
                        source: data.source,
                        confidence: data.confidence,
                        confidenceLabel: data.confidenceLabel,
                        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
                    };

                    updatedContact.data = [...contact.data, newDataPoint].slice(-100);
                }

                next.set(jid, updatedContact);

                return next;
            });
        }

        function onProfilePic(data: { jid: string, url: string | null }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid) || {
                    jid: data.jid,
                    displayNumber: formatDisplayNumber(data.jid, 'whatsapp'),
                    contactName: formatDisplayNumber(data.jid, 'whatsapp'),
                    data: [],
                    devices: [],
                    deviceCount: 0,
                    presence: null,
                    profilePic: null,
                    platform: 'whatsapp' as Platform,
                    probeMode: 'active' as const,
                    analytics: null
                };
                next.set(data.jid, { ...contact, profilePic: data.url });
                return next;
            });
        }

        function onContactName(data: { jid: string, name: string }) {
            setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(data.jid) || {
                    jid: data.jid,
                    displayNumber: formatDisplayNumber(data.jid, 'whatsapp'),
                    contactName: formatDisplayNumber(data.jid, 'whatsapp'),
                    data: [],
                    devices: [],
                    deviceCount: 0,
                    presence: null,
                    profilePic: null,
                    platform: 'whatsapp' as Platform,
                    probeMode: 'active' as const,
                    analytics: null
                };
                next.set(data.jid, { ...contact, contactName: data.name });
                return next;
            });
        }

        function onContactAdded(data: { jid: string, number: string, platform?: Platform }) {
            setContacts(prev => {
                const next = new Map(prev);
                next.set(data.jid, {
                    jid: data.jid,
                    displayNumber: data.number,
                    contactName: data.number,
                    data: [],
                    devices: [],
                    deviceCount: 0,
                    presence: null,
                    profilePic: null,
                    platform: data.platform || 'whatsapp',
                    probeMode: 'active',
                    analytics: null
                });
                return next;
            });
            setInputNumber('');
        }

        function onContactRemoved(jid: string) {
            setContacts(prev => {
                const next = new Map(prev);
                next.delete(jid);
                return next;
            });
        }

        function onError(data: { jid?: string, message: string }) {
            setError(data.message);
            setTimeout(() => setError(null), 3000);
        }

        function onProbeMethod(method: ProbeMethod) {
            setProbeMethod(method);
        }

        function onTrackedContacts(contacts: { id: string, platform: Platform }[]) {
            setContacts(prev => {
                const next = new Map(prev);
                contacts.forEach(({ id, platform }) => {
                    if (!next.has(id)) {
                        // Extract display number from id
                        let displayNumber = id;
                        if (platform === 'signal') {
                            displayNumber = id.replace('signal:', '');
                        } else {
                            // WhatsApp JID format: number@s.whatsapp.net
                            displayNumber = id.split('@')[0];
                        }
                        next.set(id, {
                            jid: id,
                            displayNumber,
                            contactName: displayNumber,
                            data: [],
                            devices: [],
                            deviceCount: 0,
                            presence: null,
                            profilePic: null,
                            platform,
                            probeMode: 'active',
                            analytics: null
                        });
                    }
                });
                return next;
            });
        }

        socket.on('tracker-update', onTrackerUpdate);
        socket.on('profile-pic', onProfilePic);
        socket.on('contact-name', onContactName);
        socket.on('contact-added', onContactAdded);
        socket.on('contact-removed', onContactRemoved);
        socket.on('error', onError);
        socket.on('probe-method', onProbeMethod);
        socket.on('tracked-contacts', onTrackedContacts);

        // Request tracked contacts after listeners are set up
        socket.emit('get-tracked-contacts');

        return () => {
            socket.off('tracker-update', onTrackerUpdate);
            socket.off('profile-pic', onProfilePic);
            socket.off('contact-name', onContactName);
            socket.off('contact-added', onContactAdded);
            socket.off('contact-removed', onContactRemoved);
            socket.off('error', onError);
            socket.off('probe-method', onProbeMethod);
            socket.off('tracked-contacts', onTrackedContacts);
        };
    }, []);

    const handleAdd = () => {
        if (!inputNumber) return;
        socket.emit('add-contact', { number: inputNumber, platform: selectedPlatform });
    };

    const handleRemove = (jid: string) => {
        socket.emit('remove-contact', jid);
    };

    const handleProbeMethodChange = (method: ProbeMethod) => {
        socket.emit('set-probe-method', method);
    };

    const probeOptions: { key: ProbeMethod; label: string }[] = [
        { key: 'delete', label: 'Delete' },
        { key: 'reaction', label: 'Reaction' },
        { key: 'passive', label: 'Passive' }
    ];

    return (
        <div className="flex h-full min-h-full flex-1 flex-col gap-5">
            {/* Add Contact Form */}
            <div className={`rounded-[30px] border px-4 py-4 sm:px-6 sm:py-5 motion-soft-reveal ${panelBaseClass}`}>
                <div className="mb-5 grid gap-5 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-start">
                    <div className="space-y-3">
                        <p className={`fine-copy text-[11px] ${helperTextClass}`}>Target Control</p>
                        <div>
                            <h2 className="tech-display text-[1.7rem] font-semibold leading-none sm:text-[1.9rem]">Add A {selectedPlatformLabel} Target</h2>
                            <p className={`mt-2 max-w-[700px] text-[13px] leading-relaxed sm:text-sm ${helperTextClass}`}>
                                Pick a number, choose the probe behavior, and let the console watch response speed on the selected {selectedPlatformLabel.toLowerCase()} lane.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2.5">
                        <p className={`text-[10px] uppercase tracking-[0.16em] ${helperTextClass}`}>Probe Method</p>
                        <div className={`inline-flex flex-wrap rounded-[16px] border p-1 ${controlClass}`}>
                            {probeOptions.map((option) => (
                                <button
                                    key={option.key}
                                    onClick={() => handleProbeMethodChange(option.key)}
                                    className={`rounded-[12px] px-3.5 py-2 text-xs font-semibold transition ${
                                        probeMethod === option.key
                                            ? selectedSegmentClass
                                            : isDarkMode
                                                ? `${quietTextClass} hover:bg-white/6`
                                                : `${quietTextClass} hover:bg-white/70`
                                    }`}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className={`grid gap-3 rounded-[22px] border p-2 sm:p-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center ${isDarkMode ? 'border-white/10 bg-black/10' : 'border-slate-300/55 bg-white/40'}`}>
                    <label className={`flex min-h-[3.15rem] items-center gap-2.5 rounded-[14px] border px-3.5 sm:px-4 ${controlClass}`}>
                        <span className={`tech-display text-sm ${helperTextClass}`}>ID</span>
                        <span className={`text-[10px] uppercase tracking-[0.16em] ${helperTextClass}`}>Target Number</span>
                        <div className={`flex h-8 min-w-0 flex-1 items-center rounded-[10px] border px-3 ${
                            isDarkMode ? 'border-white/12 bg-black/20' : 'border-slate-300/70 bg-white/70'
                        }`}>
                            <input
                                type="text"
                                placeholder={`Enter a ${selectedPlatformLabel} number`}
                                className={`w-full bg-transparent text-[14px] font-semibold outline-none placeholder:font-medium ${quietTextClass} ${isDarkMode ? 'placeholder:text-slate-500' : 'placeholder:text-slate-400'}`}
                                value={inputNumber}
                                onChange={(e) => setInputNumber(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                            />
                        </div>
                    </label>

                    <button
                        onClick={handleAdd}
                        className={`inline-flex h-12 items-center justify-center gap-1.5 rounded-[14px] border px-4 text-[10px] font-semibold uppercase tracking-[0.16em] transition lg:min-w-[164px] ${
                            isDarkMode
                                ? 'border-[#d2a757]/35 bg-[#d2a757]/14 text-[#f8dfad] hover:bg-[#d2a757]/22'
                                : 'border-[#b48836]/35 bg-[#f7edd9] text-[#6d4a14] hover:bg-[#f2e2c2]'
                        }`}
                    >
                        <Plus size={14} />
                        Add {selectedPlatformLabel}
                    </button>
                </div>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className={`text-xs leading-relaxed ${helperTextClass}`}>
                        The selected platform sets the outbound lane for new targets. Existing targets keep their own platform assignment.
                    </p>
                    {error && <p className="text-sm text-rose-400">{error}</p>}
                </div>
            </div>

            {/* Contact Cards */}
            {contacts.size === 0 ? (
                <div className="flex min-h-0 flex-1 items-stretch">
                    <div className={`${panelBaseClass} motion-soft-reveal flex h-full min-h-0 flex-1 items-center justify-center rounded-[34px] border border-dashed px-8 py-12 text-center md:px-12 md:py-14`}>
                        <div className="max-w-[760px]">
                            <p className={`fine-copy text-[11px] ${helperTextClass}`}>Waiting For A Tracked Target</p>
                            <p className="tech-display mt-4 text-[2rem] leading-none sm:text-[2.4rem]">No Active Targets</p>
                            <p className={`mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed ${helperTextClass}`}>
                                Add a number and the workspace will start resolving RTT movement, platform context, and device-state behavior into one readable lane.
                            </p>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="space-y-5">
                    {Array.from(contacts.values()).map((contact, index) => (
                        <div
                            key={contact.jid}
                            className={`motion-soft-reveal ${index === 0 ? 'motion-delay-1' : index === 1 ? 'motion-delay-2' : 'motion-delay-3'}`}
                        >
                            <ContactCard
                                jid={contact.jid}
                                displayNumber={contact.contactName}
                                data={contact.data}
                                devices={contact.devices}
                                deviceCount={contact.deviceCount}
                                presence={contact.presence}
                                profilePic={contact.profilePic}
                                onRemove={() => handleRemove(contact.jid)}
                                privacyMode={false}
                                platform={contact.platform}
                                isDarkMode={isDarkMode}
                                probeMode={contact.probeMode}
                                analytics={contact.analytics}
                            />
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
