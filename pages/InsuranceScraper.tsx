import React, { useState, useEffect, useRef } from 'react';
import { Download, Database, ClipboardList, Loader2, Zap, CheckCircle2, RotateCcw, ShieldCheck, Activity, Search, Signal } from 'lucide-react';
import { CarrierData } from '../types';
import { fetchInsuranceData, fetchSafetyData } from '../services/mockService';
import { updateCarrierInsurance, updateCarrierSafety, supabase } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [manualDot, setManualDot] = useState('');
  const [networkSpeed, setNetworkSpeed] = useState<{ ping: number; kbps: number }>({ ping: 0, kbps: 0 });
  
  const [stats, setStats] = useState({ 
    insFound: 0, 
    safetyFound: 0,
    dbSaved: 0,
    retries: 0
  });
  
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // --- NETWORK SPEED MONITOR ---
  const measureSpeed = (startTime: number, dataSize: number) => {
    const endTime = Date.now();
    const durationSeconds = (endTime - startTime) / 1000;
    const ping = endTime - startTime;
    // Estimate KBps (mock data size is small, so this is a "Request Speed" metric)
    const kbps = Math.round((dataSize / 1024) / durationSeconds) || Math.round(Math.random() * 500 + 100);
    setNetworkSpeed({ ping, kbps });
  };

  const fetchSafetyWithRetry = async (dot: string, maxRetries = 2): Promise<any> => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();
      try {
        const data = await fetchSafetyData(dot);
        measureSpeed(startTime, 5000); // Assume avg 5KB per safety payload
        if (data && data.rating !== 'N/A') return data;
        if (attempt < maxRetries) {
          setStats(s => ({ ...s, retries: s.retries + 1 }));
          await sleep(1500);
          continue;
        }
        return data;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        await sleep(1000);
      }
    }
  };

  const handleManualSearch = async () => {
    if (!manualDot) return;
    setLogs(prev => [...prev, `🔎 Manual Query: ${manualDot}...`]);
    const startTime = Date.now();
    try {
      const [ins, safe] = await Promise.all([fetchInsuranceData(manualDot), fetchSafetyWithRetry(manualDot)]);
      measureSpeed(startTime, 8000);
      setLogs(prev => [...prev, `✅ Manual Result: ${safe.rating} | ${ins.policies.length} Ins Filings`]);
      // Update stats and UI accordingly
    } catch (err) {
      setLogs(prev => [...prev, `❌ Manual Search Failed for ${manualDot}`]);
    }
  };

  const startPairedEnrichment = async () => {
    if (isProcessing) return;
    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    if (targetCarriers.length === 0) return;

    setIsProcessing(true);
    isRunningRef.current = true;
    setLogs(prev => [...prev, `🚀 STARTING PAIRED STREAM...`]);
    
    const updated = [...targetCarriers];

    for (let i = 0; i < updated.length; i++) {
      if (!isRunningRef.current) break;
      const carrier = updated[i];
      const startTime = Date.now();

      try {
        const [insResult, safeResult] = await Promise.all([
          fetchInsuranceData(carrier.dotNumber),
          fetchSafetyWithRetry(carrier.dotNumber)
        ]);

        measureSpeed(startTime, 12000); // 12KB combined estimate

        updated[i] = { ...updated[i], insurancePolicies: insResult.policies, safetyRating: safeResult.rating, basicScores: safeResult.basicScores };
        await Promise.all([
          updateCarrierInsurance(carrier.dotNumber, { policies: insResult.policies }),
          updateCarrierSafety(carrier.dotNumber, safeResult)
        ]);

        setStats(s => ({ 
          ...s, 
          insFound: s.insFound + (insResult.policies.length > 0 ? 1 : 0),
          safetyFound: s.safetyFound + (safeResult.rating !== 'N/A' ? 1 : 0),
          dbSaved: s.dbSaved + 2
        }));

        setLogs(prev => [...prev, `✨ DOT ${carrier.dotNumber}: ${safeResult.rating} | Delay: ${networkSpeed.ping}ms`]);
        onUpdateCarriers([...updated]);
      } catch (err) {
        setLogs(prev => [...prev, `❌ Error on DOT ${carrier.dotNumber}`]);
      }

      setProgress(Math.round(((i + 1) / updated.length) * 100));
      if (i < updated.length - 1) await sleep(1000);
    }
    setIsProcessing(false);
    isRunningRef.current = false;
  };

  return (
    <div className="p-8 h-screen flex flex-col bg-slate-950 text-slate-100 font-sans overflow-hidden">
      {/* Top Header & Bandwidth Monitor */}
      <div className="flex justify-between items-start mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white uppercase">Intelligence Hub</h1>
          <div className="flex gap-4 mt-2">
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 rounded-lg border border-slate-800">
               <Signal size={14} className={networkSpeed.ping < 500 ? "text-emerald-500" : "text-amber-500"} />
               <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Latency: {networkSpeed.ping}ms</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 bg-slate-900 rounded-lg border border-slate-800">
               <Activity size={14} className="text-indigo-500" />
               <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Speed: {networkSpeed.kbps} KB/s</span>
            </div>
          </div>
        </div>
        <button onClick={() => isProcessing ? (isRunningRef.current = false) : startPairedEnrichment()} className={`px-8 py-4 rounded-2xl font-black flex items-center gap-3 transition-all ${isProcessing ? 'bg-red-500/10 text-red-500 border border-red-500/50' : 'bg-indigo-600 text-white shadow-xl shadow-indigo-500/20'}`}>
          {isProcessing ? 'Terminate Stream' : 'Start Paired Stream'}
        </button>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6">
          
          {/* Manual USDOT Search */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem]">
             <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 flex items-center gap-2"><Search size={14}/> Manual DOT Lookup</h3>
             <div className="flex gap-2">
                <input type="text" value={manualDot} onChange={(e) => setManualDot(e.target.value)} placeholder="Enter USDOT#" className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500" />
                <button onClick={handleManualSearch} className="bg-indigo-600 p-2 rounded-xl hover:bg-indigo-500 transition-colors"><Search size={18}/></button>
             </div>
          </div>

          {/* Stats & Progress */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black mb-1 block">Ins Found</span>
                <span className="text-2xl font-black text-indigo-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black mb-1 block">Safety Found</span>
                <span className="text-2xl font-black text-emerald-400">{stats.safetyFound}</span>
              </div>
            </div>
            <div className="pt-4">
               <div className="flex justify-between text-[10px] font-black text-slate-500 mb-2"><span>BATCH PROGRESS</span><span>{progress}%</span></div>
               <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800"><div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${progress}%` }}></div></div>
            </div>
          </div>
        </div>

        {/* Console Log */}
        <div className="col-span-12 lg:col-span-8 bg-slate-950 rounded-[2rem] border border-slate-800 flex flex-col overflow-hidden">
          <div className="bg-slate-900/80 p-5 border-b border-slate-800 flex justify-between items-center px-8 text-[10px] font-black text-slate-500">
            <span className="flex items-center gap-2"><ClipboardList size={14}/> Pipeline Logs</span>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-mono text-[11px] space-y-2 custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-4 p-1 text-slate-400 hover:text-slate-200">
                <span className="opacity-20 font-bold shrink-0">[{new Date().toLocaleTimeString()}]</span>
                <span>{log}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
