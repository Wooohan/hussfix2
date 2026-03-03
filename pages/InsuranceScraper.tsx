import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Play, Download, Database, SearchIcon, ClipboardList, Loader2, CheckCircle2, Info, AlertCircle, ShieldAlert, Zap } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData, fetchSafetyData } from '../services/mockService';
import { updateCarrierInsurance, updateCarrierSafety } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ carriers, onUpdateCarriers, autoStart }) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStage, setCurrentStage] = useState<'IDLE' | 'INSURANCE' | 'SAFETY' | 'ENRICHING'>('IDLE');
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
  
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{policies: InsurancePolicy[], safety?: any} | null>(null);
  
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (autoStart && carriers.length > 0 && !isProcessing && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      startEnrichmentProcess();
    }
  }, [autoStart, carriers]);

  const handleManualCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDot) return;
    setIsManualLoading(true);
    setManualResult(null);
    try {
      const { policies } = await fetchInsuranceData(manualDot);
      const safety = await fetchSafetyData(manualDot);
      setManualResult({ policies, safety });
    } catch (error) {
      console.error("Manual check failed", error);
    } finally {
      setIsManualLoading(false);
    }
  };

  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    const start = parseInt(mcRangeStart);
    const end = parseInt(mcRangeEnd);
    
    if (isNaN(start) || isNaN(end) || start > end) {
      setLogs(prev => [...prev, `❌ Invalid MC range: ${mcRangeStart}-${mcRangeEnd}`]);
      return;
    }

    setLogs(prev => [...prev, `🔍 Filtering local database for MC range: ${start} to ${end}...`]);
    
    const filtered = carriers.filter(c => {
      const mc = parseInt(c.mcNumber);
      return !isNaN(mc) && mc >= start && mc <= end;
    });

    setMcRangeCarriers(filtered);
    setLogs(prev => [...prev, `✅ Found ${filtered.length} carriers in range.`]);
  };

  /**
   * HIGH-SPEED PARALLEL ENRICHMENT ENGINE
   * Processes carriers in chunks of 5 for maximum speed
   */
  const startEnrichmentProcess = async () => {
    if (isProcessing) return;
    
    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    
    if (targetCarriers.length === 0) {
      setLogs(prev => [...prev, "❌ Error: No carriers to process."]);
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setCurrentStage('ENRICHING');
    
    setLogs(prev => [...prev, `🚀 ENGINE START: Processing ${targetCarriers.length} records...`]);
    setLogs(prev => [...prev, `⚡ Mode: Parallel Chunking (Speed: 5x)`]);

    const updatedData = [...targetCarriers];
    let dbSavedCount = 0;
    let insCount = 0;
    let safetyCount = 0;

    const CHUNK_SIZE = 5;

    for (let i = 0; i < updatedData.length; i += CHUNK_SIZE) {
      if (!isRunningRef.current) break;

      const chunk = updatedData.slice(i, i + CHUNK_SIZE);
      
      // Process chunk in parallel
      await Promise.all(chunk.map(async (carrier, index) => {
        const globalIndex = i + index;
        const dot = carrier.dotNumber;

        if (!dot || dot === 'UNKNOWN') return;

        try {
          // Parallel fetch: Insurance + Safety
          const [insRes, safetyRes] = await Promise.all([
            fetchInsuranceData(dot),
            fetchSafetyData(dot)
          ]);

          // Update local data
          updatedData[globalIndex] = {
            ...updatedData[globalIndex],
            insurancePolicies: insRes.policies,
            safetyRating: safetyRes.rating,
            safetyRatingDate: safetyRes.ratingDate,
            basicScores: safetyRes.basicScores,
            oosRates: safetyRes.oosRates
          };

          // Parallel Supabase Sync
          const [dbIns, dbSaf] = await Promise.all([
            updateCarrierInsurance(dot, { policies: insRes.policies }),
            updateCarrierSafety(dot, safetyRes)
          ]);

          // Increment counters safely
          if (insRes.policies.length > 0) insCount++;
          if (safetyRes.rating !== 'N/A') safetyCount++;
          if (dbIns.success) dbSavedCount++;
          if (dbSaf.success) dbSavedCount++;

          setLogs(prev => [...prev, `✨ [${dot}] Processed & Synced`]);
          
        } catch (err) {
          setLogs(prev => [...prev, `❌ [${dot}] Failed: ${err.message}`]);
        }
      }));

      // Update UI every chunk
      const currentProgress = Math.min(100, Math.round(((i + CHUNK_SIZE) / updatedData.length) * 100));
      setProgress(currentProgress);
      setStats(prev => ({
        ...prev,
        insFound: insCount,
        safetyFound: safetyCount,
        dbSaved: dbSavedCount
      }));
      
      // Batch sync to parent component
      onUpdateCarriers([...updatedData]);
    }

    setIsProcessing(false);
    isRunningRef.current = false;
    setCurrentStage('IDLE');
    setLogs(prev => [...prev, `🎉 ENRICHMENT COMPLETE. Total DB Updates: ${dbSavedCount}`]);
  };

  const handleExport = () => {
    const target = mcRangeMode ? mcRangeCarriers : carriers;
    const enriched = target.filter(c => c.insurancePolicies || c.safetyRating);
    if (enriched.length === 0) return;
    
    const headers = ["DOT", "Legal Name", "Safety Rating", "Insurance Carrier", "Coverage"];
    const rows = enriched.map(c => [
      c.dotNumber,
      `"${c.legalName}"`,
      c.safetyRating || 'N/A',
      c.insurancePolicies?.[0]?.carrier || 'N/A',
      c.insurancePolicies?.[0]?.coverageAmount || 'N/A'
    ]);

    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `enriched_intel_${new Date().getTime()}.csv`;
    link.click();
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative selection:bg-indigo-500/20">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Intelligence Enrichment Center</h1>
          <p className="text-slate-400">High-Speed FMCSA & Insurance Sync Engine</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()}
            className={`flex items-center gap-3 px-8 py-3 rounded-2xl font-black transition-all shadow-2xl ${
                isProcessing ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/20'
            }`}
          >
            {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Stop</> : <><Zap size={20} /> Run Batch</>}
          </button>
          <button 
            disabled={stats.dbSaved === 0}
            onClick={handleExport}
            className="flex items-center gap-3 px-6 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-2xl font-bold transition-all border border-slate-700"
          >
            <Download size={20} /> Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          
          {isProcessing && (
            <div className="p-4 rounded-2xl border bg-indigo-500/10 border-indigo-500/30 text-indigo-400 flex items-center gap-3 animate-pulse">
               <Loader2 className="animate-spin" size={20} />
               <span className="text-xs font-black uppercase tracking-widest">Enriching via Parallel Pipeline...</span>
            </div>
          )}

          <div className="bg-slate-850 border border-slate-700/50 p-6 rounded-3xl shadow-xl">
             <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                   <Database size={16} className="text-indigo-400" /> MC Range Mode
                </h3>
                <button
                  onClick={() => setMcRangeMode(!mcRangeMode)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    mcRangeMode ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-400'
                  }`}
                >
                  {mcRangeMode ? 'ON' : 'OFF'}
                </button>
             </div>
             
             {mcRangeMode && (
               <div className="space-y-3">
                  <input
                    type="text"
                    value={mcRangeStart}
                    onChange={(e) => setMcRangeStart(e.target.value)}
                    placeholder="Start MC"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none"
                  />
                  <input
                    type="text"
                    value={mcRangeEnd}
                    onChange={(e) => setMcRangeEnd(e.target.value)}
                    placeholder="End MC"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white text-sm outline-none"
                  />
                  <button
                    onClick={handleMcRangeSearch}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg py-2 text-sm font-bold"
                  >
                    Filter Local Range
                  </button>
                  {mcRangeCarriers.length > 0 && (
                    <p className="text-[10px] text-slate-400 text-center">Found {mcRangeCarriers.length} carriers in memory</p>
                  )}
               </div>
             )}
          </div>

          <div className="bg-slate-850 border border-slate-700/50 p-6 rounded-3xl shadow-xl">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest mb-6 flex items-center gap-3">
                <Database size={16} className="text-indigo-400" /> Live Statistics
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <span className="text-[10px] text-slate-500 block mb-1 font-black uppercase">Insurance</span>
                <span className="text-2xl font-black text-indigo-400">{stats.insFound}</span>
              </div>
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30">
                <span className="text-[10px] text-slate-500 block mb-1 font-black uppercase">Safety</span>
                <span className="text-2xl font-black text-emerald-400">{stats.safetyFound}</span>
              </div>
              <div className="bg-slate-900/50 p-4 rounded-2xl border border-slate-700/30 col-span-2">
                <span className="text-[10px] text-slate-500 block mb-1 font-black uppercase">Supabase Syncs</span>
                <span className="text-2xl font-black text-purple-400">{stats.dbSaved}</span>
              </div>
            </div>
            <div className="mt-6">
               <div className="flex justify-between text-[10px] mb-2 font-black text-slate-500 uppercase">
                  <span>Batch Progress</span>
                  <span className="text-white">{progress}%</span>
               </div>
               <div className="w-full bg-slate-900 rounded-full h-2">
                  <div className="bg-indigo-500 h-2 rounded-full transition-all" style={{ width: `${progress}%` }}></div>
               </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800/50 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex justify-between items-center px-8">
            <div className="flex items-center gap-3">
                <ClipboardList size={18} className="text-slate-500" />
                <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">Pipeline Stream</span>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-mono text-xs space-y-2 custom-scrollbar">
            {logs.length === 0 && <span className="text-slate-700 italic block text-center py-20">Waiting for engine activation...</span>}
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 p-2 rounded-lg ${log.includes('❌') ? 'text-red-400 bg-red-400/5' : log.includes('✅') || log.includes('✨') ? 'text-emerald-400 bg-emerald-400/5' : 'text-slate-400'}`}>
                <span className="opacity-30">[{new Date().toLocaleTimeString().split(' ')[0]}]</span>
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
