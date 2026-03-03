import React, { useState, useEffect, useRef } from 'react';
import { Download, Database, SearchIcon, ClipboardList, Loader2, Play, Zap } from 'lucide-react';
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
  
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{policies: InsurancePolicy[], safety?: any} | null>(null);
  
  const [mcRangeMode, setMcRangeMode] = useState(false);
  const [mcRangeStart, setMcRangeStart] = useState('');
  const [mcRangeEnd, setMcRangeEnd] = useState('');
  const [mcRangeCarriers, setMcRangeCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Fix 1: Search Range directly from Supabase Database
  const handleMcRangeSearch = async () => {
    if (!mcRangeStart || !mcRangeEnd) return;
    setIsManualLoading(true);
    setLogs(prev => [...prev, `🔍 Querying Database for MC range: ${mcRangeStart} to ${mcRangeEnd}...`]);
    
    try {
      const { data, error } = await supabase
        .from('carriers') // Ensure your table name is 'carriers'
        .select('*')
        .gte('mc_number', mcRangeStart)
        .lte('mc_number', mcRangeEnd);

      if (error) throw error;

      if (data && data.length > 0) {
        // Map database fields to CarrierData interface if necessary
        const mappedData: CarrierData[] = data.map(c => ({
          dotNumber: c.dot_number,
          mcNumber: c.mc_number,
          legalName: c.legal_name,
          insurancePolicies: [],
          ...c
        }));
        setMcRangeCarriers(mappedData);
        setLogs(prev => [...prev, `✅ Found ${mappedData.length} records in Database range.`]);
      } else {
        setLogs(prev => [...prev, `⚠️ No carriers found in that range in Supabase.`]);
      }
    } catch (err: any) {
      setLogs(prev => [...prev, `❌ DB Error: ${err.message}`]);
    } finally {
      setIsManualLoading(false);
    }
  };

  // Fix 2 & 3: Fast Enrichment with accurate DB counters
  const startEnrichmentProcess = async () => {
    if (isProcessing) return;
    
    const targetCarriers = mcRangeMode ? mcRangeCarriers : carriers;
    if (targetCarriers.length === 0) {
      setLogs(prev => [...prev, "❌ Error: No carriers to process."]);
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setLogs(prev => [...prev, `🚀 ENGINE START: Processing ${targetCarriers.length} records...`]);
    
    const updated = [...targetCarriers];
    const BATCH_SIZE = 5; // Faster: processes 5 at a time

    // STAGE 1: Insurance
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
          setLogs(prev => [...prev, `✨ [INS] ${carrier.dotNumber}: ${policies.length} filings found`]);
        } catch (err) {
          setStats(s => ({ ...s, insFailed: s.insFailed + 1 }));
        }
      }));
      setProgress(Math.round(((i + batch.length) / updated.length) * 50));
      onUpdateCarriers([...updated]);
    }

    // STAGE 2: Safety
    setCurrentStage('SAFETY');
    for (let i = 0; i < updated.length; i += BATCH_SIZE) {
      if (!isRunningRef.current) break;
      const batch = updated.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (carrier, index) => {
        const globalIdx = i + index;
        try {
          const s = await fetchSafetyData(carrier.dotNumber);
          updated[globalIdx] = { ...updated[globalIdx], safetyRating: s.rating, basicScores: s.basicScores };
          
          const save = await updateCarrierSafety(carrier.dotNumber, s);
          if (save.success) setStats(s => ({ ...s, dbSaved: s.dbSaved + 1 }));
          
          setStats(s => ({ ...s, safetyFound: s.safetyFound + (s.rating !== 'N/A' ? 1 : 0) }));
          setLogs(prev => [...prev, `🛡️ [SAFE] ${carrier.dotNumber}: ${s.rating}`]);
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
    setLogs(prev => [...prev, `🎉 BATCH COMPLETE. Updates synced to Supabase.`]);
  };

  const handleManualCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualDot) return;
    setIsManualLoading(true);
    try {
      const { policies } = await fetchInsuranceData(manualDot);
      const safety = await fetchSafetyData(manualDot);
      setManualResult({ policies, safety });
    } catch (error) {
      console.error(error);
    } finally {
      setIsManualLoading(false);
    }
  };

  const handleExport = () => {
    const dataToExport = mcRangeMode ? mcRangeCarriers : carriers;
    const csvContent = "data:text/csv;charset=utf-8," + 
      ["DOT,MC,Name,Safety,Insurance"].join(",") + "\n" +
      dataToExport.map(c => `${c.dotNumber},${c.mcNumber},"${c.legalName}",${c.safetyRating || 'N/A'},${c.insurancePolicies?.length || 0}`).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "carrier_intel.csv");
    document.body.appendChild(link);
    link.click();
  };

  return (
    <div className="p-8 h-screen flex flex-col overflow-hidden relative bg-slate-950 text-white">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Intelligence Enrichment Center</h1>
          <p className="text-slate-400">Database-Driven MC Range & Safety Intelligence</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => isProcessing ? (isRunningRef.current = false) : startEnrichmentProcess()}
            className={`flex items-center gap-3 px-8 py-3 rounded-2xl font-black transition-all ${
                isProcessing ? 'bg-red-500 hover:bg-red-600' : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {isProcessing ? <><Loader2 className="animate-spin" size={20} /> Stop</> : <><Zap size={20} /> Run Batch Enrichment</>}
          </button>
          <button onClick={handleExport} className="flex items-center gap-3 px-6 py-3 bg-slate-800 rounded-2xl font-bold border border-slate-700">
            <Download size={20} /> Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6 flex-1 min-h-0">
        <div className="col-span-12 lg:col-span-4 space-y-6 overflow-y-auto pr-2 custom-scrollbar">
          
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-xl">
             <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-black text-slate-500 uppercase flex items-center gap-2">
                   <Database size={16} className="text-indigo-400" /> MC Range Mode
                </h3>
                <button onClick={() => setMcRangeMode(!mcRangeMode)} className={`px-3 py-1 rounded-lg text-xs font-bold ${mcRangeMode ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                  {mcRangeMode ? 'ON' : 'OFF'}
                </button>
             </div>
             {mcRangeMode && (
               <div className="space-y-3">
                  <input type="text" value={mcRangeStart} onChange={(e) => setMcRangeStart(e.target.value)} placeholder="Start MC" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                  <input type="text" value={mcRangeEnd} onChange={(e) => setMcRangeEnd(e.target.value)} placeholder="End MC" className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                  <button onClick={handleMcRangeSearch} disabled={isManualLoading} className="w-full bg-indigo-600 py-2 rounded-lg text-sm font-bold flex justify-center">
                    {isManualLoading ? <Loader2 className="animate-spin" size={18} /> : "Search Database Range"}
                  </button>
               </div>
             )}
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
            <h3 className="text-sm font-black text-slate-500 uppercase mb-4 flex items-center gap-3">
              <SearchIcon size={16} className="text-indigo-400" /> Quick Lookup
            </h3>
            <form onSubmit={handleManualCheck} className="relative">
              <input type="text" value={manualDot} onChange={(e) => setManualDot(e.target.value)} placeholder="Enter USDOT..." className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-4 pr-12 py-3 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-indigo-400">
                {isManualLoading ? <Loader2 size={20} className="animate-spin" /> : <Play size={20} />}
              </button>
            </form>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-black uppercase">Ins Found</span>
                <span className="text-2xl font-black text-indigo-400 block">{stats.insFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800">
                <span className="text-[10px] text-slate-500 font-black uppercase">Safety</span>
                <span className="text-2xl font-black text-emerald-400 block">{stats.safetyFound}</span>
              </div>
              <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 col-span-2">
                <span className="text-[10px] text-slate-500 font-black uppercase">Supabase Syncs</span>
                <span className="text-2xl font-black text-purple-400 block">{stats.dbSaved}</span>
              </div>
            </div>
            <div className="mt-6">
              <div className="flex justify-between text-[10px] mb-2 font-black text-slate-500 uppercase">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2">
                <div className="bg-gradient-to-r from-indigo-500 to-emerald-500 h-2 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
              </div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-8 flex flex-col bg-slate-950 rounded-[2rem] border border-slate-800 overflow-hidden shadow-2xl">
          <div className="bg-slate-900/80 p-4 border-b border-slate-800 flex justify-between items-center px-8">
            <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
              <ClipboardList size={18} /> Enrichment Stream
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-8 font-mono text-xs space-y-2 custom-scrollbar">
            {logs.map((log, i) => (
              <div key={i} className={`flex gap-4 p-2 rounded-lg ${log.includes('❌') ? 'bg-red-500/5 text-red-400' : 'hover:bg-slate-900 text-slate-400'}`}>
                <span className="opacity-30">[{new Date().toLocaleTimeString()}]</span>
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
