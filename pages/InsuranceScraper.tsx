import React, { useState, useEffect, useRef } from 'react';
import { Download, Database, SearchIcon, ClipboardList, Loader2, Play, Zap, ShieldAlert, CheckCircle2 } from 'lucide-react';
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
    dbSaved: 0
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

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    setLogs(prev => [...prev, `🔍 Querying Supabase for MC range: ${mcRangeStart} - ${mcRangeEnd}...`]);
    
    try {
      const { data, error } = await supabase
        .from('carriers')
        .select('*')
        .gte('mc_number', mcRangeStart)
        .lte('mc_number', mcRangeEnd);

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
    if (targetCarriers.length === 0) {
      setLogs(prev => [...prev, "❌ Error: No carriers to process."]);
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setLogs(prev => [...prev, `🚀 ENGINE START: Syncing ${targetCarriers.length} records...`]);
    
    const updated = [...targetCarriers];
    const BATCH_SIZE = 5;

    // --- STAGE 1: INSURANCE ---
    setCurrentStage('INSURANCE');
    for (let i = 0; i < updated.length; i += BATCH_SIZE) {
      if (!isRunningRef.current) break;
      const batch = updated.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (carrier, index) => {
        const globalIdx = i + index;
        try {
          const { policies } = await fetchInsuranceData(carrier.dotNumber);
          updated[globalIdx].insurancePolicies = policies;
          
          const save = await updateCarrierInsurance(carrier.dotNumber, { policies });
          if (save.success) setStats(s => ({ ...s, dbSaved: s.dbSaved + 1 }));
          setStats(s => ({ ...s, insFound: s.insFound + (policies.length > 0 ? 1 : 0) }));
          setLogs(prev => [...prev, `✨ [INS] ${carrier.dotNumber}: ${policies.length} filings`]);
        } catch (err) {
          setStats(s => ({ ...s, insFailed: s.insFailed + 1 }));
        }
      }));
      setProgress(Math.round(((i + batch.length) / updated.length) * 50));
      onUpdateCarriers([...updated]);
    }

    // --- STAGE 2: SAFETY & BASIC SCORES (Colab Style) ---
    setCurrentStage('SAFETY');
    for (let i = 0; i < updated.length; i += BATCH_SIZE) {
      if (!isRunningRef.current) break;
      const batch = updated.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (carrier, index) => {
        const globalIdx = i + index;
        try {
          const s = await fetchSafetyData(carrier.dotNumber);
          
          // Map scores exactly like the Colab "Final Report"
          updated[globalIdx] = { 
            ...updated[globalIdx], 
            safetyRating: s.rating,
            basicScores: s.basicScores, // This contains Unsafe Driving, HOS, Maint, etc.
            oosRates: s.oosRates
          };
          
          const save = await updateCarrierSafety(carrier.dotNumber, s);
          if (save.success) setStats(s => ({ ...s, dbSaved: s.dbSaved + 1 }));
          setStats(s => ({ ...s, safetyFound: s.safetyFound + 1 }));
          
          const maint = s.basicScores?.vehicleMaint || 0;
          setLogs(prev => [...prev, `🛡️ [SAFE] ${carrier.dotNumber}: ${s.rating} (Maint: ${maint}%)`]);
        } catch (err) {
          setStats(s => ({ ...s, safetyFailed: s.safetyFailed + 1 }));
        }
      }));
      setProgress(50 + Math.round(((i + batch.length) / updated.length) * 50));
      onUpdateCarriers([...updated]);
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    setCurrentStage('IDLE');
    setLogs(prev => [...prev, `🎉 BATCH COMPLETE. All BASIC scores synced.`]);
  };

  const handleExport = () => {
    const data = mcRangeMode ? mcRangeCarriers : carriers;
    const headers = "DOT,MC,Name,Rating,Unsafe,HOS,Maint,Drugs,Fitness,Crash";
    const rows = data.map(c => {
      const b = c.basicScores;
      return `${c.dotNumber},${c.mcNumber},"${c.legalName}",${c.safetyRating || 'NR'},${b?.unsafeDriving || 0},${b?.hosCompliance || 0},${b?.vehicleMaint || 0},${b?.drugsAlcohol || 0},${b?.driverFitness || 0},"${b?.crashIndicator || 'Not Public'}"`;
    });
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `enrichment_${new Date().getTime()}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden bg-slate-950 text-slate-100 selection:bg-indigo-500/30">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tighter text-white">INTELLIGENCE ENRICHMENT</h1>
          <p className="text-slate-500 font-medium">BASIC Safety Percentiles & Insurance Extraction</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()}
            className={`px-6 py-3 rounded-xl font-bold flex items-center gap-2 transition-all shadow-lg ${
              isProcessing ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-500/20'
            }`}
          >
            {isProcessing ? <><Loader2 className="animate-spin" size={18} /> Stop</> : <><Zap size={18} /> Run Enrichment</>}
          </button>
          <button onClick={handleExport} className="px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold flex items-center gap-2">
            <Download size={18} /> Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        {/* Left Panel: Controls & Metrics */}
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          
          {/* Status Tracker */}
          {isProcessing && (
            <div className={`p-4 rounded-2xl border flex items-center gap-3 animate-pulse ${currentStage === 'INSURANCE' ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'}`}>
              <Loader2 className="animate-spin" size={20} />
              <span className="text-xs font-black uppercase tracking-widest">Active Stage: {currentStage}</span>
            </div>
          )}

          {/* Database Range Filter */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem]">
             <div className="flex items-center justify-between mb-6">
                <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                   <Database size={14} className="text-indigo-400" /> Database Range Mode
                </h3>
                <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-3 py-1 rounded-lg text-[10px] font-black ${mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-500'}`}>
                  {mcRangeMode ? 'ACTIVE' : 'OFF'}
                </button>
             </div>
             {mcRangeMode && (
               <div className="space-y-3 animate-in fade-in duration-300">
                  <div className="grid grid-cols-2 gap-3">
                    <input type="text" value={mcRangeStart} onChange={(e) => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                    <input type="text" value={mcRangeEnd} onChange={(e) => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                  </div>
                  <button onClick={handleMcRangeSearch} className="w-full bg-slate-800 hover:bg-slate-700 py-2 rounded-xl text-xs font-bold transition-colors">
                    Load Carriers from DB
                  </button>
               </div>
             )}
          </div>

          {/* Real-time Counters */}
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-[2rem] space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Insurance</span>
                <span className="text-2xl font-black text-indigo-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800/50">
                <span className="text-[10px] text-slate-500 font-black uppercase block mb-1">Safety Scores</span>
                <span className="text-2xl font-black text-emerald-400">{stats.safetyFound}</span>
              </div>
            </div>
            <div className="bg-indigo-500/5 border border-indigo-500/20 p-4 rounded-2xl">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[10px] text-indigo-400 font-black uppercase tracking-widest">Supabase Sync Success</span>
                <CheckCircle2 size={14} className="text-indigo-400" />
              </div>
              <span className="text-2xl font-black text-white">{stats.dbSaved}</span>
            </div>
            <div className="pt-2">
              <div className="flex justify-between text-[10px] mb-2 font-black text-slate-500 uppercase">
                <span>Batch Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-full transition-all duration-500" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel: Terminal Log */}
        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800 overflow-hidden shadow-2xl relative">
          <div className="bg-slate-900/50 p-4 border-b border-slate-800 flex justify-between items-center px-8">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={14} /> Enrichment Pipeline Stream
            </span>
            <div className="flex gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500/50"></div>
              <div className="w-2 h-2 rounded-full bg-yellow-500/50"></div>
              <div className="w-2 h-2 rounded-full bg-green-500/50"></div>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 font-mono text-[11px] space-y-2 custom-scrollbar">
            {logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-700 opacity-40">
                <ShieldAlert size={40} className="mb-4" />
                <p className="uppercase font-black tracking-widest">System Idle - Awaiting Batch</p>
              </div>
            )}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 p-2 rounded-lg transition-colors ${log.includes('❌') ? 'bg-red-500/5 text-red-400' : 'hover:bg-slate-900/50 text-slate-400'}`}>
                <span className="opacity-20 shrink-0">[{new Date().toLocaleTimeString()}]</span>
                <span className={log.includes('✨') ? 'text-indigo-300' : log.includes('🛡️') ? 'text-emerald-300' : ''}>{log}</span>
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
