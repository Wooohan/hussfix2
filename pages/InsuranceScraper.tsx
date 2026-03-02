import React, { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Play, Download, Database, SearchIcon, ClipboardList, Loader2, CheckCircle2, Info, AlertCircle, ShieldAlert, Zap } from 'lucide-react';
import { CarrierData, InsurancePolicy } from '../types';
import { fetchInsuranceData, fetchSafetyData } from '../services/mockService';
import { updateCarrierInsurance, updateCarrierSafety, supabase } from '../services/supabaseClient';

interface InsuranceScraperProps {
  carriers: CarrierData[];
  onUpdateCarriers: (newData: CarrierData[]) => void;
  autoStart?: boolean;
  scrapedMCs?: string[]; // MCs from current scrape cycle
}

export const InsuranceScraper: React.FC<InsuranceScraperProps> = ({ 
  carriers, 
  onUpdateCarriers, 
  autoStart,
  scrapedMCs 
}) => {
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
  
  // Manual Lookup State
  const [manualDot, setManualDot] = useState('');
  const [isManualLoading, setIsManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<{policies: InsurancePolicy[], safety?: any} | null>(null);

  // MC Range Selection State
  const [mcRangeMode, setMcRangeMode] = useState<'all' | 'batch' | 'manual'>('all');
  const [manualMcStart, setManualMcStart] = useState('');
  const [manualMcEnd, setManualMcEnd] = useState('');
  const [filteredCarriers, setFilteredCarriers] = useState<CarrierData[]>([]);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const isRunningRef = useRef(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Update filtered carriers based on selection mode
  useEffect(() => {
    updateFilteredCarriers();
  }, [mcRangeMode, carriers, scrapedMCs, manualMcStart, manualMcEnd]);

  const updateFilteredCarriers = () => {
    let filtered: CarrierData[] = [];

    if (mcRangeMode === 'batch' && scrapedMCs && scrapedMCs.length > 0) {
      // Filter to only carriers from current scrape batch
      filtered = carriers.filter(c => scrapedMCs.includes(c.mcNumber));
      setLogs(prev => [...prev, `📋 Batch mode: Processing ${filtered.length} carriers from current scrape`]);
    } else if (mcRangeMode === 'manual' && manualMcStart && manualMcEnd) {
      // Filter to MC range
      const start = parseInt(manualMcStart);
      const end = parseInt(manualMcEnd);
      filtered = carriers.filter(c => {
        const mc = parseInt(c.mcNumber);
        return mc >= start && mc <= end;
      });
      setLogs(prev => [...prev, `🔍 Manual range: Found ${filtered.length} carriers between MC ${manualMcStart}-${manualMcEnd}`]);
    } else {
      // All carriers
      filtered = carriers;
    }

    setFilteredCarriers(filtered);
  };

  // Handle Auto-Start from Live Scraper (only on batch mode if scrapedMCs provided)
  useEffect(() => {
    if (autoStart && carriers.length > 0 && !isProcessing && !hasAutoStarted.current) {
      hasAutoStarted.current = true;
      
      // If scrapedMCs provided, use batch mode; otherwise use all
      if (scrapedMCs && scrapedMCs.length > 0) {
        setMcRangeMode('batch');
        setTimeout(() => startEnrichmentProcess(), 500);
      } else {
        setMcRangeMode('all');
        setTimeout(() => startEnrichmentProcess(), 500);
      }
    }
  }, [autoStart, carriers]);

  const startEnrichmentProcess = async () => {
    if (isProcessing) return;
    if (filteredCarriers.length === 0) {
      setLogs(prev => [...prev, "❌ Error: No carriers selected. Please select a mode and try again."]);
      return;
    }

    setIsProcessing(true);
    isRunningRef.current = true;
    setLogs(prev => [...prev, `🚀 ENGINE INITIALIZED: Automatic Multi-Stage Enrichment...`]);
    setLogs(prev => [...prev, `🔍 Targeting: ${filteredCarriers.length} USDOT records`]);
    setLogs(prev => [...prev, `📊 Mode: ${mcRangeMode === 'batch' ? 'Current Scrape Batch' : mcRangeMode === 'manual' ? 'Manual MC Range' : 'All Carriers'}`]);
    setLogs(prev => [...prev, `💾 Supabase sync: ENABLED`]);
    
    const updatedCarriers = [...filteredCarriers];
    let dbSaved = 0;

    // --- STAGE 1: INSURANCE EXTRACTION ---
    setCurrentStage('INSURANCE');
    setLogs(prev => [...prev, `📂 STAGE 1: Insurance Extraction (SearchCarriers API)`]);
    
    let insFound = 0;
    let insFailed = 0;

    for (let i = 0; i < updatedCarriers.length; i++) {
      if (!isRunningRef.current) break;
      const dot = updatedCarriers[i].dotNumber;
      
      setLogs(prev => [...prev, `⏳ [INSURANCE] [${i+1}/${updatedCarriers.length}] Querying DOT: ${dot}...`]);
      
      try {
        if (!dot || dot === '' || dot === 'UNKNOWN') throw new Error("Invalid DOT");
        const { policies } = await fetchInsuranceData(dot);
        updatedCarriers[i] = { ...updatedCarriers[i], insurancePolicies: policies };
        
        // Save to Supabase
        const saveResult = await updateCarrierInsurance(dot, { policies });
        if (saveResult.success) {
          dbSaved++;
        }
        
        if (policies.length > 0) {
          insFound++;
          setLogs(prev => [...prev, `✨ Success: Extracted ${policies.length} insurance filings for ${dot} → DB synced`]);
        } else {
          setLogs(prev => [...prev, `⚠️ Info: No active insurance found for ${dot}`]);
        }
      } catch (err) {
        insFailed++;
        setLogs(prev => [...prev, `❌ Fail: Insurance timeout for DOT ${dot}`]);
      }

      setProgress(Math.round(((i + 1) / updatedCarriers.length) * 50));
      setStats(prev => ({ ...prev, total: updatedCarriers.length, insFound, insFailed, dbSaved }));
    }

    // --- STAGE 2: SAFETY RATING & BASIC PERFORMANCE ---
    setCurrentStage('SAFETY');
    setLogs(prev => [...prev, `🛡️ STAGE 2: Safety Rating & BASIC Performance (FMCSA API)`]);
    
    let safetyFound = 0;
    let safetyFailed = 0;

    for (let i = 0; i < updatedCarriers.length; i++) {
      if (!isRunningRef.current) break;
      const dot = updatedCarriers[i].dotNumber;
      
      setLogs(prev => [...prev, `⏳ [SAFETY] [${i+1}/${updatedCarriers.length}] Fetching safety data for DOT: ${dot}...`]);
      
      try {
        if (!dot || dot === '' || dot === 'UNKNOWN') throw new Error("Invalid DOT");
        const safetyData = await fetchSafetyData(dot);
        updatedCarriers[i] = { ...updatedCarriers[i], ...safetyData };
        
        // Save to Supabase
        const saveResult = await updateCarrierSafety(dot, safetyData);
        if (saveResult.success) {
          dbSaved++;
        }
        
        if (safetyData.safetyRating) {
          safetyFound++;
          setLogs(prev => [...prev, `✅ Safety data updated for DOT: ${dot} → DB synced`]);
        } else {
          setLogs(prev => [...prev, `⚠️ Info: No safety data found for ${dot}`]);
        }
      } catch (err) {
        safetyFailed++;
        setLogs(prev => [...prev, `❌ Fail: Safety data timeout for DOT ${dot}`]);
      }

      setProgress(50 + Math.round(((i + 1) / updatedCarriers.length) * 50));
      setStats(prev => ({ ...prev, safetyFound, safetyFailed, dbSaved }));
    }

    // --- COMPLETION ---
    setCurrentStage('IDLE');
    setProgress(100);
    setLogs(prev => [...prev, `💾 Total Supabase updates: ${dbSaved}`]);
    setLogs(prev => [...prev, `🎉 ENRICHMENT COMPLETE. Database fully synchronized.`]);
    setIsProcessing(false);
    isRunningRef.current = false;
    onUpdateCarriers(updatedCarriers);
  };

  const stopProcess = () => {
    isRunningRef.current = false;
    setIsProcessing(false);
    setCurrentStage('IDLE');
    setLogs(prev => [...prev, '⏹️ Process stopped by user']);
  };

  const handleManualLookup = async () => {
    if (!manualDot) return;
    
    setIsManualLoading(true);
    try {
      const { policies } = await fetchInsuranceData(manualDot);
      const safetyData = await fetchSafetyData(manualDot);
      setManualResult({ policies, safety: safetyData });
      setLogs(prev => [...prev, `🔍 Manual lookup for DOT ${manualDot}: Found ${policies.length} policies`]);
    } catch (err) {
      setLogs(prev => [...prev, `❌ Manual lookup failed for DOT ${manualDot}`]);
    } finally {
      setIsManualLoading(false);
    }
  };

  return (
    <div className="p-6 h-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-200 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-lg">
              <ShieldCheck className="text-white" size={24} />
            </div>
            Insurance & Safety Enrichment
          </h1>
          <p className="text-slate-400 text-sm mt-1">Automatic carrier insurance and safety data extraction</p>
        </div>
        <div className="flex items-center gap-3">
          {isProcessing && (
            <button
              onClick={stopProcess}
              className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition-all"
            >
              <Loader2 size={16} className="animate-spin" />
              Stop
            </button>
          )}
          <button
            onClick={startEnrichmentProcess}
            disabled={isProcessing || filteredCarriers.length === 0}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white rounded-lg text-sm font-semibold transition-all shadow-lg shadow-emerald-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            {isProcessing ? 'Processing...' : 'Start Enrichment'}
          </button>
        </div>
      </div>

      {/* MC Range Selection */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 rounded-lg p-4 backdrop-blur-sm mb-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-4">Select Processing Mode</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* All Carriers Option */}
          <label className="flex items-center p-3 bg-slate-900/50 border border-slate-600/50 rounded-lg cursor-pointer hover:border-indigo-500/50 transition-colors">
            <input
              type="radio"
              name="mcMode"
              value="all"
              checked={mcRangeMode === 'all'}
              onChange={(e) => setMcRangeMode(e.target.value as any)}
              className="mr-3"
            />
            <div>
              <p className="font-semibold text-slate-200">All Carriers</p>
              <p className="text-xs text-slate-400">Process all {carriers.length} carriers in database</p>
            </div>
          </label>

          {/* Batch Mode Option */}
          <label className="flex items-center p-3 bg-slate-900/50 border border-slate-600/50 rounded-lg cursor-pointer hover:border-green-500/50 transition-colors">
            <input
              type="radio"
              name="mcMode"
              value="batch"
              checked={mcRangeMode === 'batch'}
              onChange={(e) => setMcRangeMode(e.target.value as any)}
              disabled={!scrapedMCs || scrapedMCs.length === 0}
              className="mr-3"
            />
            <div>
              <p className="font-semibold text-slate-200">Current Batch</p>
              <p className="text-xs text-slate-400">
                {scrapedMCs && scrapedMCs.length > 0 
                  ? `Process ${scrapedMCs.length} carriers from current scrape`
                  : 'No batch data available'}
              </p>
            </div>
          </label>

          {/* Manual Range Option */}
          <label className="flex items-center p-3 bg-slate-900/50 border border-slate-600/50 rounded-lg cursor-pointer hover:border-blue-500/50 transition-colors">
            <input
              type="radio"
              name="mcMode"
              value="manual"
              checked={mcRangeMode === 'manual'}
              onChange={(e) => setMcRangeMode(e.target.value as any)}
              className="mr-3"
            />
            <div>
              <p className="font-semibold text-slate-200">Manual Range</p>
              <p className="text-xs text-slate-400">Specify MC number range</p>
            </div>
          </label>
        </div>

        {/* Manual Range Input */}
        {mcRangeMode === 'manual' && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">Start MC</label>
              <input
                type="number"
                value={manualMcStart}
                onChange={(e) => setManualMcStart(e.target.value)}
                placeholder="e.g., 1580000"
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">End MC</label>
              <input
                type="number"
                value={manualMcEnd}
                onChange={(e) => setManualMcEnd(e.target.value)}
                placeholder="e.g., 1580050"
                className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500/50"
              />
            </div>
          </div>
        )}

        {/* Status */}
        <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400 text-sm">
          📊 Selected: <span className="font-semibold">{filteredCarriers.length}</span> carriers
        </div>
      </div>

      {/* Manual Lookup Section */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 rounded-lg p-4 backdrop-blur-sm mb-6">
        <h3 className="text-sm font-semibold text-slate-300 mb-3">Manual DOT Lookup</h3>
        <div className="flex gap-3">
          <input
            type="text"
            value={manualDot}
            onChange={(e) => setManualDot(e.target.value)}
            placeholder="Enter USDOT number..."
            className="flex-1 px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
          />
          <button
            onClick={handleManualLookup}
            disabled={isManualLoading || !manualDot}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50"
          >
            {isManualLoading ? <Loader2 size={16} className="animate-spin" /> : <SearchIcon size={16} />}
          </button>
        </div>
        {manualResult && (
          <div className="mt-3 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm">
            ✅ Found {manualResult.policies.length} insurance policies
          </div>
        )}
      </div>

      {/* Progress Bar */}
      {isProcessing && (
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-semibold text-slate-300">Progress</span>
            <span className="text-sm text-slate-400">{progress}%</span>
          </div>
          <div className="w-full bg-slate-900/50 border border-slate-700/50 rounded-full h-2 overflow-hidden">
            <div
              className="bg-gradient-to-r from-emerald-600 to-emerald-500 h-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats */}
      {stats.total > 0 && (
        <div className="grid grid-cols-6 gap-2 mb-6">
          <div className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3 text-center">
            <p className="text-xs text-slate-400">Total</p>
            <p className="text-xl font-bold text-white">{stats.total}</p>
          </div>
          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 text-center">
            <p className="text-xs text-green-400">Insurance ✓</p>
            <p className="text-xl font-bold text-green-400">{stats.insFound}</p>
          </div>
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-center">
            <p className="text-xs text-red-400">Insurance ✗</p>
            <p className="text-xl font-bold text-red-400">{stats.insFailed}</p>
          </div>
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center">
            <p className="text-xs text-blue-400">Safety ✓</p>
            <p className="text-xl font-bold text-blue-400">{stats.safetyFound}</p>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-center">
            <p className="text-xs text-yellow-400">Safety ✗</p>
            <p className="text-xl font-bold text-yellow-400">{stats.safetyFailed}</p>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-center">
            <p className="text-xs text-purple-400">DB Saved</p>
            <p className="text-xl font-bold text-purple-400">{stats.dbSaved}</p>
          </div>
        </div>
      )}

      {/* Logs */}
      <div className="flex-1 overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/20 backdrop-blur-sm">
        <div className="h-full overflow-y-auto p-4 font-mono text-xs">
          {logs.length === 0 ? (
            <div className="text-slate-500 text-center py-8">
              <Zap className="mx-auto mb-2 opacity-50" size={32} />
              <p>Select a mode and click "Start Enrichment" to begin</p>
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="text-slate-300 mb-1 whitespace-pre-wrap break-words">
                {log}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>
    </div>
  );
};

export default InsuranceScraper;
