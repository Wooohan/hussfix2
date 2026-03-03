import React, { useState, useEffect, useRef } from 'react';
import { Download, Database, SearchIcon, ClipboardList, Loader2, Play, Zap, ShieldAlert, CheckCircle2, RotateCcw } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData, fetchSafetyData } from '../services/mockService';
import { updateCarrierInsurance, updateCarrierSafety, supabase } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStage, setCurrentStage] = useState<'IDLE' | 'INSURANCE' | 'SAFETY'>('IDLE');
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState({ 
    total: 0, 
    insFound: 0, 
    insFailed: 0,
    safetyFound: 0,
    safetyFailed: 0,
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

  // Helper: Sleep function for staggering and backoff
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // --- RETRY LOGIC ENGINE ---
  const fetchSafetyWithRetry = async (dot: string, maxRetries = 3): Promise<any> => {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const data = await fetchSafetyData(dot);
        // If we got a real rating or real BASIC scores, return it
        if (data && data.rating !== 'N/A') return data;
        
        // If it's N/A but we have retries left, wait and try again
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s backoff
          setLogs(prev => [...prev, `🔄 [RETRY] DOT ${dot} returned N/A. Attempt ${attempt + 1}/${maxRetries} in ${delay}ms...`]);
          setStats(s => ({ ...s, retries: s.retries + 1 }));
          await sleep(delay);
          continue;
        }
        return data; // Return the N/A if all retries exhausted
      } catch (err) {
        lastError = err;
        if (attempt === maxRetries) throw lastError;
        await sleep(1000);
      }
    }
  };

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    setLogs(prev => [...prev, `🔍 Querying Supabase for MC range: ${mcRangeStart} - ${mcRangeEnd}...`]);
    try {
      const { data, error } = await supabase.from('carriers').select('*').gte('mc_number', mcRangeStart).lte('mc_number', mcRangeEnd);
      if (error) throw error;
      if (data) {
        setMcRangeCarriers(data);
        setLogs(prev => [...prev, `✅ Found ${data.length} records in range.`]);
      }
    } catch (err: any) {
      setLogs(prev => [...prev, `❌ DB Error: ${err.message}`]);
    }
  };

  const startEnrichmentProcess = async () => {
    if (isProcessing) return;
    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    if (targetCarriers.length === 0) return;

    setIsProcessing(true);
    isRunningRef.current = true;
    setLogs(prev => [...prev, `🚀 ENGINE START: Syncing ${targetCarriers.length} records with Retry Logic...`]);
    
    const updated = [...targetCarriers];
    const BATCH_SIZE = 3; // Reduced batch size for stability

    // STAGE 1: INSURANCE
    setCurrentStage('INSURANCE');
    for (let i = 0; i < updated.length; i += BATCH_SIZE) {
      if (!isRunningRef.current) break;
      const batch = updated.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (carrier, index) => {
        const globalIdx = i + index;
        try {
          const { policies } = await fetchInsuranceData(carrier.dotNumber);
          updated[globalIdx].insurancePolicies = policies;
          await updateCarrierInsurance(carrier.dotNumber, { policies });
          setStats(s => ({ ...s, dbSaved: s.dbSaved + 1, insFound: s.insFound + (policies.length > 0 ? 1 : 0) }));
          setLogs(prev => [...prev, `✨ [INS] ${carrier.dotNumber}: ${policies.length} filings`]);
        } catch (err) { setStats(s => ({ ...s, insFailed: s.insFailed + 1 })); }
      }));
      await sleep(500); // Stagger batches
      setProgress(Math.round(((i + batch.length) / updated.length) * 50));
    }

    // STAGE 2: SAFETY (With Retry & Backoff)
    setCurrentStage('SAFETY');
    for (let i = 0; i < updated.length; i += BATCH_SIZE) {
      if (!isRunningRef.current) break;
      const batch = updated.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (carrier, index) => {
        const globalIdx = i + index;
        try {
          // CALL THE RETRY WRAPPER
          const s = await fetchSafetyWithRetry(carrier.dotNumber);
          
          updated[globalIdx] = { ...updated[globalIdx], safetyRating: s.rating, basicScores: s.basicScores };
          await updateCarrierSafety(carrier.dotNumber, s);
          
          setStats(s => ({ ...s, dbSaved: s.dbSaved + 1, safetyFound: s.safetyFound + 1 }));
          const maint = s.basicScores?.vehicleMaint || 0;
          setLogs(prev => [...prev, `🛡️ [SAFE] ${carrier.dotNumber}: ${s.rating} (${maint}%)`]);
        } catch (err) {
          setStats(s => ({ ...s, safetyFailed: s.safetyFailed + 1 }));
        }
      }));
      await sleep(800); // Wait longer between safety batches to avoid N/A triggers
      setProgress(50 + Math.round(((i + batch.length) / updated.length) * 50));
      onUpdateCarriers([...updated]);
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    setCurrentStage('IDLE');
    setLogs(prev => [...prev, `🎉 BATCH COMPLETE. Retries Used: ${stats.retries}`]);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white">INTELLIGENCE ENRICHMENT</h1>
          <p className="text-slate-500 font-medium">Retry-Enabled BASIC Safety & Insurance Extraction</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()} className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all ${isProcessing ? 'bg-red-500 shadow-red-500/20' : 'bg-indigo-600 shadow-indigo-500/20'}`}>
            {isProcessing ? <><Loader2 className="animate-spin" size={18} /> Stop</> : <><Zap size={18} /> Run Enrichment</>}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem]">
             <div className="flex items-center justify-between mb-6 text-xs font-black text-slate-500 uppercase tracking-widest">
               <span className="flex items-center gap-2"><Database size={14} className="text-indigo-400" /> DB Range</span>
               <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-3 py-1 rounded-lg ${mcRangeMode ? 'bg-indigo-600' : 'bg-slate-800'}`}>{mcRangeMode ? 'ON' : 'OFF'}</button>
             </div>
             {mcRangeMode && (
               <div className="grid grid-cols-2 gap-3 mb-3">
                  <input type="text" value={mcRangeStart} onChange={(e) => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none" />
                  <input type="text" value={mcRangeEnd} onChange={(e) => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none" />
                  <button onClick={handleMcRangeSearch} className="col-span-2 bg-slate-800 hover:bg-slate-700 py-2 rounded-xl text-xs font-bold">Load Records</button>
               </div>
             )}
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Insurance</span>
                <span className="text-2xl font-black text-indigo-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Retries</span>
                <span className="text-2xl font-black text-amber-400">{stats.retries}</span>
              </div>
            </div>
            <div className="bg-indigo-500/5 border border-indigo-500/20 p-4 rounded-2xl flex justify-between items-center">
              <div>
                <span className="text-[10px] text-indigo-400 font-black uppercase block">DB Syncs</span>
                <span className="text-2xl font-black text-white">{stats.dbSaved}</span>
              </div>
              <CheckCircle2 size={24} className="text-indigo-400" />
            </div>
            <div className="pt-2">
              <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800 overflow-hidden relative">
          <div className="bg-slate-900/50 p-4 border-b border-slate-800 flex justify-between items-center px-8 text-[10px] font-black text-slate-500 uppercase tracking-widest">
            <span className="flex items-center gap-2"><ClipboardList size={14} /> Pipeline Log</span>
            <div className="flex items-center gap-2"><RotateCcw size={12} /> Auto-Retry V2.1</div>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-mono text-[11px] space-y-2 custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 p-2 rounded-lg ${log.includes('🔄') ? 'bg-amber-500/5 text-amber-400 border border-amber-500/10' : 'hover:bg-slate-900/50 text-slate-400'}`}>
                <span className="opacity-20 shrink-0">[{new Date().toLocaleTimeString()}]</span>
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
