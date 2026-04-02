import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Square, Activity, Wifi, Smartphone, Monitor } from 'lucide-react';
import clsx from 'clsx';

type Platform = 'whatsapp' | 'signal';

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

interface ContactCardProps {
    jid: string;
    displayNumber: string;
    data: TrackerData[];
    devices: DeviceInfo[];
    deviceCount: number;
    presence: string | null;
    profilePic: string | null;
    onRemove: () => void;
    privacyMode?: boolean;
    platform?: Platform;
    isDarkMode?: boolean;
    probeMode?: 'active' | 'passive';
    analytics?: ActivityAnalytics | null;
}

function isActiveState(state: string) {
    return state.includes('Active') || state.includes('Online');
}

function isIdleState(state: string) {
    return state.includes('Idle') || state === 'Standby';
}

function formatSourceLabel(source: TrackerData['source']) {
    if (source === 'phone') return 'Phone';
    if (source === 'desktop') return 'Desktop';
    if (source === 'mixed') return 'Mixed';
    return 'Unknown';
}

function getChartDomain(data: TrackerData[]) {
    const visiblePoints = data.slice(-28);
    const values = visiblePoints
        .flatMap((point) => [point.rtt, point.avg, point.threshold])
        .filter((value) => Number.isFinite(value) && value >= 0)
        .sort((a, b) => a - b);

    if (values.length === 0) {
        return ['auto', 'auto'] as const;
    }

    const trimStart = values.length > 10 ? Math.floor(values.length * 0.15) : 0;
    const trimEnd = values.length > 10 ? Math.ceil(values.length * 0.9) : values.length;
    const trimmed = values.slice(trimStart, Math.max(trimStart + 1, trimEnd));
    const minValue = trimmed[0];
    const maxValue = trimmed[trimmed.length - 1];
    const spread = Math.max(0, maxValue - minValue);
    const padding = spread === 0
        ? Math.max(2, Math.round(maxValue * 0.2))
        : Math.max(4, Math.round(spread * 0.18));
    const lowerBound = Math.max(0, Math.floor(minValue - padding));
    const minRangeUpper = lowerBound + 8;
    const upperBound = Math.max(minRangeUpper, Math.ceil(maxValue + padding));

    return [
        lowerBound,
        upperBound
    ] as const;
}

function smoothMetricSeries(values: number[], damping: number, deltaFactor: number) {
    if (values.length === 0) return values;

    const smoothed: number[] = [];
    let prev = Number.isFinite(values[0]) ? values[0] : 0;
    smoothed.push(prev);

    for (let i = 1; i < values.length; i += 1) {
        const rawValue = Number.isFinite(values[i]) ? values[i] : prev;
        const maxDelta = Math.max(6, Math.abs(prev) * deltaFactor);
        const limited = prev + Math.max(-maxDelta, Math.min(maxDelta, rawValue - prev));
        const next = prev + (limited - prev) * damping;
        prev = Number.isFinite(next) ? next : prev;
        smoothed.push(Math.round(prev * 10) / 10);
    }

    return smoothed;
}

function buildDisplayChartData(data: TrackerData[]) {
    if (data.length <= 2) return data;

    const rttSeries = smoothMetricSeries(data.map((point) => point.rtt), 0.36, 0.24);
    const avgSeries = smoothMetricSeries(data.map((point) => point.avg), 0.44, 0.2);
    const thresholdSeries = smoothMetricSeries(data.map((point) => point.threshold), 0.5, 0.16);

    return data.map((point, index) => ({
        ...point,
        rtt: rttSeries[index],
        avg: avgSeries[index],
        threshold: thresholdSeries[index]
    }));
}

function getStatusTone(state: string, isDarkMode: boolean) {
    if (state === 'OFFLINE') {
        return isDarkMode
            ? 'border-rose-400/25 bg-rose-500/12 text-rose-100'
            : 'border-rose-300/60 bg-rose-50 text-rose-700';
    }

    if (isActiveState(state)) {
        return isDarkMode
            ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'
            : 'border-emerald-400/50 bg-emerald-100 text-emerald-800';
    }

    return isDarkMode
        ? 'border-amber-300/30 bg-amber-400/14 text-amber-100'
        : 'border-amber-400/50 bg-amber-100 text-amber-800';
}

function getConfidenceTone(confidenceLabel: string | undefined, isDarkMode: boolean) {
    if (confidenceLabel === 'High') {
        return isDarkMode
            ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'
            : 'border-emerald-400/50 bg-emerald-100 text-emerald-800';
    }

    if (confidenceLabel === 'Medium') {
        return isDarkMode
            ? 'border-amber-300/30 bg-amber-400/14 text-amber-100'
            : 'border-amber-400/50 bg-amber-100 text-amber-800';
    }

    return isDarkMode
        ? 'border-amber-300/30 bg-amber-500/12 text-amber-100'
        : 'border-amber-400/50 bg-amber-100 text-amber-800';
}

function formatMetricValue(value: number | undefined, unit?: string) {
    if (value === undefined || !Number.isFinite(value)) {
        return '--';
    }

    const roundedValue = Math.round(value);
    return unit ? `${roundedValue} ${unit}` : `${roundedValue}`;
}

export function ContactCard({
    jid,
    displayNumber,
    data,
    devices,
    deviceCount,
    presence,
    profilePic,
    onRemove,
    privacyMode = false,
    platform = 'whatsapp',
    isDarkMode = false,
    probeMode = 'active',
    analytics = null
}: ContactCardProps) {
    const [introAnimationEnabled, setIntroAnimationEnabled] = useState(true);
    const lastData = data[data.length - 1];
    const rawChartData = data.slice(-40);
    const chartData = buildDisplayChartData(rawChartData);
    const chartDomain = getChartDomain(chartData);
    const confidenceValue = lastData?.confidence;
    const confidenceLabel = lastData?.confidenceLabel || 'Low';
    const analyticsData: ActivityAnalytics = analytics || {
        messageCount1h: 0,
        messageCount24h: 0,
        callCount1h: 0,
        callCount24h: 0,
        repeatedCallerFingerprint: null,
        repeatedCallerCount: 0,
        topSourceFingerprint: null,
        topSourceEvents24h: 0,
        lastInboundAt: null,
        lastCallAt: null
    };
    const sourceLabel = formatSourceLabel(lastData?.source);
    const platformLabel = platform === 'signal' ? 'Signal' : 'WhatsApp';
    const currentStatus = devices.length > 0
        ? (devices.find(d => d.state === 'OFFLINE')?.state ||
            devices.find(d => isActiveState(d.state))?.state ||
            devices.find(d => isIdleState(d.state))?.state ||
            devices[0].state)
        : lastData?.state || 'Unknown';

    // Blur phone number in privacy mode
    const blurredNumber = privacyMode ? displayNumber.replace(/\d/g, '•') : displayNumber;

    const sectionBaseClass = isDarkMode
        ? 'border border-white/10 bg-white/[0.03] text-slate-100'
        : 'border border-slate-300/70 bg-white/45 text-slate-900';
    const mutedTextClass = isDarkMode ? 'text-slate-400' : 'text-slate-500';
    const supportTextClass = isDarkMode ? 'text-slate-300' : 'text-slate-700';
    const outerCardClass = isDarkMode ? 'glass-dark' : 'glass-light';
    const metricCards = probeMode === 'passive'
        ? [
            { label: 'Current Score', value: formatMetricValue(lastData?.rtt), icon: Activity },
            { label: 'Rolling Avg', value: formatMetricValue(lastData?.avg), icon: Activity },
            { label: '24h Baseline', value: formatMetricValue(lastData?.median) },
            { label: 'Trigger Floor', value: formatMetricValue(lastData?.threshold) }
        ]
        : [
            { label: 'Latest RTT', value: formatMetricValue(lastData?.rtt, 'ms') },
            { label: 'Current Avg', value: formatMetricValue(lastData?.avg, 'ms'), icon: Activity },
            { label: 'Median', value: formatMetricValue(lastData?.median, 'ms') },
            { label: 'Active Threshold', value: formatMetricValue(lastData?.threshold, 'ms') }
        ];
    const analyticsSummary = [
        { label: 'Messages', hint: '1h / 24h' },
        { label: 'Calls', hint: '1h / 24h' },
        { label: 'Repeat Caller', hint: analyticsData.repeatedCallerCount > 0 ? `${analyticsData.repeatedCallerCount} repeats` : 'No repeats' },
        { label: 'Top Source', hint: analyticsData.topSourceEvents24h > 0 ? `${analyticsData.topSourceEvents24h} events` : 'No events' }
    ];
    const showChartDots = chartData.length <= 2;

    useEffect(() => {
        const timeoutId = window.setTimeout(() => {
            setIntroAnimationEnabled(false);
        }, 950);

        return () => window.clearTimeout(timeoutId);
    }, []);

    return (
        <div className={`${outerCardClass} overflow-hidden rounded-[32px] border`}>
            {/* Header with Stop Button */}
            <div className={`border-b px-5 py-3 sm:px-6 sm:py-3.5 ${isDarkMode ? 'border-white/10' : 'border-slate-300/55'}`}>
                <div className="flex flex-col gap-3 xl:grid xl:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_auto] xl:items-center xl:gap-4">
                    <div className="min-w-0">
                        <p className={`fine-copy text-[10px] ${mutedTextClass}`}>Tracked Contact</p>
                        <h3 className={`mt-3 tech-display text-lg sm:text-xl ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{blurredNumber}</h3>
                    </div>

                    <div className={clsx(
                        "grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 xl:grid-cols-4 xl:gap-x-0",
                        isDarkMode ? 'xl:divide-x xl:divide-white/10' : 'xl:divide-x xl:divide-slate-300/55'
                    )}>
                        {analyticsSummary.map((item) => (
                            <div key={item.label} className="min-w-0 xl:px-4 xl:first:pl-0 xl:last:pr-0">
                                <div className={`fine-copy text-[9px] ${mutedTextClass}`}>{item.label}</div>
                                <div className={`mt-1 text-[11px] leading-relaxed ${supportTextClass}`}>{item.hint}</div>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={onRemove}
                        className={`inline-flex h-10 min-w-[132px] items-center justify-center gap-2 self-start rounded-full border px-4 text-xs font-semibold uppercase tracking-[0.12em] transition xl:self-center ${
                            isDarkMode
                                ? 'border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15'
                                : 'border-rose-300/60 bg-rose-50 text-rose-700 hover:bg-rose-100'
                        }`}
                    >
                        <Square size={16} /> Stop
                    </button>
                </div>

            </div>

            <div className="p-4 sm:p-5">
                <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)]">
                    {/* Status Card */}
                    <div className={`${sectionBaseClass} flex min-h-[280px] flex-col rounded-[24px] p-5 text-center sm:p-6`}>
                        <div className="relative mb-4 flex justify-center">
                            <div className={`h-32 w-32 overflow-hidden rounded-full border sm:h-36 sm:w-36 ${isDarkMode ? 'border-white/10 bg-slate-800' : 'border-white/80 bg-[#ede4d3]'}`}>
                                {profilePic ? (
                                    <img
                                        src={profilePic}
                                        alt="Profile"
                                        referrerPolicy="no-referrer"
                                        className={clsx(
                                            "w-full h-full object-cover transition-all duration-200",
                                            privacyMode && "blur-xl scale-110"
                                        )}
                                        style={privacyMode ? {
                                            filter: 'blur(16px) contrast(0.8)',
                                        } : {}}
                                    />
                                        ) : (
                                    <div className={`flex h-full w-full items-center justify-center text-sm ${mutedTextClass}`}>
                                        No Image
                                    </div>
                                )}
                            </div>
                            <div className={clsx(
                                "absolute bottom-2 right-[calc(50%-70px)] h-6 w-6 rounded-full border-2",
                                isDarkMode ? 'border-slate-950' : 'border-[#f4eee3]',
                                currentStatus === 'OFFLINE' ? "bg-rose-500" :
                                    isActiveState(currentStatus) ? "bg-emerald-400" :
                                        isIdleState(currentStatus) ? "bg-amber-300" : "bg-amber-300"
                            )} />
                        </div>

                        <h4 className={`tech-display mb-2 text-[1.55rem] leading-tight sm:text-[1.72rem] ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{blurredNumber}</h4>
                        <p className={`mb-4 text-sm ${mutedTextClass}`}>Live contact summary and device-state overview.</p>

                        <div className="mb-5 flex flex-wrap items-center justify-center gap-2">
                            <span className={clsx("rounded-full border px-2.5 py-1 text-xs font-semibold", getConfidenceTone(confidenceLabel, isDarkMode))}>
                                Confidence {confidenceLabel}
                            </span>
                            <span className={`text-xs font-medium ${mutedTextClass}`}>
                                {confidenceValue !== undefined ? `${confidenceValue}% signal` : 'warming up'}
                            </span>
                        </div>

                        <div className={`w-full space-y-3 border-t pt-5 ${isDarkMode ? 'border-white/10' : 'border-slate-300/55'}`}>
                            <div className={`flex items-center justify-between text-sm ${supportTextClass}`}>
                                <span className="flex items-center gap-1"><Wifi size={16} /> Official Status</span>
                                <span className="font-medium">{presence || 'Unknown'}</span>
                            </div>
                            <div className={`flex items-center justify-between text-sm ${supportTextClass}`}>
                                <span className="flex items-center gap-1"><Smartphone size={16} /> Devices</span>
                                <span className="font-medium">{deviceCount || 0}</span>
                            </div>
                            <div className={`flex items-center justify-between text-sm ${supportTextClass}`}>
                                <span>Platform</span>
                                <span className="font-medium">{platformLabel}</span>
                            </div>
                            <div className={`flex items-center justify-between text-sm ${supportTextClass}`}>
                                <span>Likely Source</span>
                                <span className="font-medium">{sourceLabel}</span>
                            </div>
                            <div className={`flex items-center justify-between text-sm ${supportTextClass}`}>
                                <span>Identifier</span>
                                <span className="truncate pl-3 text-right text-xs">{jid}</span>
                            </div>
                        </div>

                        {/* Device List */}
                        {devices.length > 0 && (
                            <div className={`mt-5 w-full border-t pt-5 ${isDarkMode ? 'border-white/10' : 'border-slate-300/55'}`}>
                                <h5 className={`fine-copy mb-3 text-[10px] ${mutedTextClass}`}>Device States</h5>
                                <div className="space-y-2">
                                    {devices.map((device, idx) => (
                                        <div key={device.jid} className={`flex items-center justify-between rounded-2xl border px-3 py-2 text-sm ${isDarkMode ? 'border-white/10 bg-black/10' : 'border-slate-300/55 bg-white/35'}`}>
                                            <div className="flex items-center gap-2">
                                                <Monitor size={14} className={mutedTextClass} />
                                                <span className={supportTextClass}>Device {idx + 1}</span>
                                            </div>
                                            <span className={clsx(
                                                "rounded-full border px-2 py-0.5 text-xs font-medium",
                                                getStatusTone(device.state, isDarkMode)
                                            )}>
                                                {device.state}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Metrics & Chart */}
                    <div className="flex h-full min-h-0 flex-col gap-4 self-stretch">
                        {/* Metrics Grid */}
                        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                            {metricCards.map((metric) => {
                                const MetricIcon = metric.icon;

                                return (
                                    <div key={metric.label} className={`${sectionBaseClass} rounded-[20px] p-4 text-center`}>
                                        <div className={`fine-copy mb-2 flex items-center justify-center gap-2 text-[10px] ${mutedTextClass}`}>
                                            {MetricIcon ? <MetricIcon size={14} /> : null}
                                            {metric.label}
                                        </div>
                                        <div className={`tech-display text-[1.35rem] sm:text-[1.48rem] ${isDarkMode ? 'text-slate-100' : 'text-slate-900'}`}>{metric.value}</div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Chart */}
                        <div className={`${sectionBaseClass} flex h-full min-h-[360px] flex-1 flex-col overflow-hidden rounded-[24px] p-4 sm:min-h-[420px] sm:p-5`}>
                            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                                <div>
                                    <p className={`fine-copy text-[10px] ${mutedTextClass}`}>Telemetry Window</p>
                                    <h5 className="tech-display mt-2 text-lg sm:text-xl">{probeMode === 'passive' ? 'Passive Event Window' : 'Recent RTT Detail'}</h5>
                                </div>
                                <p className={`max-w-[360px] text-xs leading-relaxed lg:text-right ${mutedTextClass}`}>
                                    {probeMode === 'passive'
                                        ? 'Passive mode listens for visible events and avoids outbound probes.'
                                        : 'Raw RTT, moving average, and active threshold are compressed into the most recent signal window.'}
                                </p>
                            </div>
                            <div className="min-h-0 flex-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    {chartData.length === 0 ? (
                                        <div className={`flex h-full items-center justify-center text-sm ${mutedTextClass}`}>
                                            Waiting for telemetry data...
                                        </div>
                                    ) : (
                                        <LineChart data={chartData} margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                                            <CartesianGrid
                                                strokeDasharray="3 3"
                                                vertical={false}
                                                stroke={isDarkMode ? 'rgba(148, 163, 184, 0.2)' : 'rgba(100, 116, 139, 0.22)'}
                                            />
                                            <XAxis dataKey="timestamp" hide />
                                            <YAxis
                                                width={40}
                                                domain={chartDomain}
                                                allowDataOverflow={false}
                                                tick={{ fill: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 11 }}
                                                axisLine={false}
                                                tickLine={false}
                                            />
                                            <Tooltip
                                                labelFormatter={(label: any) => {
                                                    if (label === undefined || label === null) return '';
                                                    const labelValue = typeof label === 'string' ? label.trim() : label;
                                                    const timestamp = typeof labelValue === 'number'
                                                        ? labelValue
                                                        : Number(labelValue);
                                                    if (Number.isNaN(timestamp)) return String(label);
                                                    return new Date(timestamp).toLocaleTimeString();
                                                }}
                                                contentStyle={{
                                                    borderRadius: '16px',
                                                    border: '1px solid rgba(148, 163, 184, 0.18)',
                                                    boxShadow: '0 20px 55px rgba(0, 0, 0, 0.18)',
                                                    backgroundColor: isDarkMode ? '#08131f' : '#fff9ef'
                                                }}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="rtt"
                                                stroke={isDarkMode ? '#cbd5e1' : '#475569'}
                                                strokeWidth={1.6}
                                                dot={showChartDots ? { r: 2.5, strokeWidth: 0 } : false}
                                                name={probeMode === 'passive' ? 'Score' : 'RTT'}
                                                isAnimationActive={introAnimationEnabled}
                                                animationDuration={880}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="avg"
                                                stroke={isDarkMode ? '#f8fafc' : '#1e293b'}
                                                strokeWidth={2.2}
                                                dot={showChartDots ? { r: 2.7, strokeWidth: 0 } : false}
                                                name={probeMode === 'passive' ? 'Avg Score' : 'Avg RTT'}
                                                isAnimationActive={introAnimationEnabled}
                                                animationDuration={980}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="threshold"
                                                stroke={isDarkMode ? '#cbd5e1' : '#94a3b8'}
                                                strokeDasharray="5 5"
                                                dot={showChartDots ? { r: 2.3, strokeWidth: 0 } : false}
                                                name={probeMode === 'passive' ? 'Trigger Floor' : 'Threshold'}
                                                isAnimationActive={introAnimationEnabled}
                                                animationDuration={1040}
                                            />
                                        </LineChart>
                                    )}
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
