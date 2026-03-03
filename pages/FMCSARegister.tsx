import React, { useState, useEffect } from 'react';
import { FileText, RefreshCw, Calendar, Search, Filter, ChevronDown, ExternalLink, AlertCircle, X, Database, CheckCircle2, TrendingUp, BarChart3, Clock, ArrowRight } from 'lucide-react';
import { saveFMCSARegisterEntries, fetchFMCSARegisterByExtractedDate, getExtractedDates } from '../services/fmcsaRegisterService';

interface FMCSARegisterEntry {
  number: string;
  title: string;
  decided: string;
  category: string;
  extracted_date?: string;
}

export const FMCSARegister: React.FC = () => {
  const [registerData, setRegisterData] = useState<FMCSARegisterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(getTodayDate());
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [error, setError] = useState<string>('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [categoryStats, setCategoryStats] = useState<Record<string, number>>({});
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const categories = [
    'NAME CHANGE',
    'CERTIFICATE, PERMIT, LICENSE',
    'CERTIFICATE OF REGISTRATION',
    'DISMISSAL',
    'WITHDRAWAL',
    'REVOCATION',
    'TRANSFERS',
    'GRANT DECISION NOTICES',
    'MISCELLANEOUS'
  ];

  // LOGIC PRESERVED
  function getTodayDate(): string {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  function formatDateForAPI(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = months[date.getUTCMonth()];
    const year = String(date.getUTCFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  }

  useEffect(() => {
    loadAvailableDates();
  }, []);

  useEffect(() => {
    const stats: Record<string, number> = {};
    registerData.forEach(entry => {
      stats[entry.category] = (stats[entry.category] || 0) + 1;
    });
    setCategoryStats(stats);
  }, [registerData]);

  const loadAvailableDates = async () => {
    try {
      const dates = await getExtractedDates();
      setAvailableDates(dates);
    } catch (err) {
      console.error('Error loading available dates:', err);
    }
  };

  const handleSearch = async () => {
    setIsSearching(true);
    setError('');
    try {
      const data = await fetchFMCSARegisterByExtractedDate(selectedDate, {
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        searchTerm: searchTerm || undefined
      });
      if (data && data.length > 0) {
        setRegisterData(data);
        setLastUpdated(`✅ Loaded ${data.length} records from database`);
      } else {
        setRegisterData([]);
        setLastUpdated('');
        setError(`No data found for ${selectedDate}.`);
      }
    } catch (err) {
      setError('Error searching database.');
    } finally {
      setIsSearching(false);
    }
  };

  const fetchRegisterData = async () => {
    setIsLoading(true);
    setError('');
    try {
      const formattedDate = formatDateForAPI(selectedDate);
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiUrl = isLocal ? 'http://localhost:3001/api/fmcsa-register' : '/api/fmcsa-register';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: formattedDate })
      });
      if (!response.ok) throw new Error(`Server error: ${response.status}`);
      const data = await response.json();
      if (data.success && data.entries && data.entries.length > 0) {
        setRegisterData(data.entries);
        setLastUpdated(`Live: ${new Date().toLocaleTimeString()} (${data.count} records)`);
        saveToSupabase(data.entries, selectedDate);
        loadAvailableDates();
      } else {
        throw new Error('No entries found on FMCSA for this date.');
      }
    } catch (err: any) {
      setError(err.message || 'Unable to fetch live data.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveToSupabase = async (entries: FMCSARegisterEntry[], extractedDate: string) => {
    setSaveStatus('saving');
    try {
      const result = await saveFMCSARegisterEntries(
        entries.map(e => ({ ...e, extracted_date: extractedDate })),
        extractedDate,
        extractedDate
      );
      if (result.success) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      setSaveStatus('error');
    }
  };

  const filteredData = registerData.filter(entry => {
    const matchesCategory = selectedCategory === 'all' || entry.category === selectedCategory;
    const matchesSearch = entry.title.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         entry.number.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      'NAME CHANGE': 'text-blue-400 border-blue-500/30 bg-blue-500/10',
      'CERTIFICATE, PERMIT, LICENSE': 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
      'CERTIFICATE OF REGISTRATION': 'text-purple-400 border-purple-500/30 bg-purple-500/10',
      'DISMISSAL': 'text-amber-400 border-amber-500/30 bg-amber-500/10',
      'WITHDRAWAL': 'text-orange-400 border-orange-500/30 bg-orange-500/10',
      'REVOCATION': 'text-rose-400 border-rose-500/30 bg-rose-500/10',
    };
    return colors[category] || 'text-slate-400 border-slate-500/30 bg-slate-500/10';
  };

  return (
    <div className="p-6 h-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-200 font-sans">
      
      {/* HEADER SECTION */}
      <div className="flex justify-between items-center mb-8 shrink-0">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-600/20 border border-indigo-500/30 rounded-2xl shadow-lg shadow-indigo-500/10">
            <FileText className="text-indigo-400" size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">FMCSA <span className="text-indigo-400">Register</span></h1>
            <p className="text-slate-500 text-xs font-medium uppercase tracking-wider">Operational Dashboard</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end mr-2">
            {saveStatus === 'saving' && <span className="text-[10px] text-indigo-400 animate-pulse font-bold flex items-center gap-1"><Database size={10}/> SYNCING</span>}
            {saveStatus === 'saved' && <span className="text-[10px] text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 size={10}/> SECURE</span>}
          </div>
          <button
            onClick={fetchRegisterData}
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-indigo-900/20 disabled:opacity-50"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'FETCHING...' : 'FETCH LIVE'}
          </button>
        </div>
      </div>

      {/* STATS ROW */}
      {registerData.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-6 shrink-0">
          {[
            { label: 'Records', val: registerData.length, icon: TrendingUp, color: 'text-indigo-400' },
            { label: 'Categories', val: Object.keys(categoryStats).length, icon: BarChart3, color: 'text-purple-400' },
            { label: 'Active', val: filteredData.length, icon: Search, color: 'text-emerald-400' },
            { label: 'Top Type', val: Object.entries(categoryStats).sort(([,a], [,b]) => b - a)[0]?.[0].split(' ')[0] || 'N/A', icon: Filter, color: 'text-amber-400' },
          ].map((s, i) => (
            <div key={i} className="bg-slate-900/40 border border-slate-800/60 rounded-2xl p-4 backdrop-blur-sm transition-transform hover:scale-[1.02]">
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-slate-500 text-[10px] uppercase font-bold tracking-widest">{s.label}</p>
                  <p className="text-xl font-bold text-white mt-1">{s.val}</p>
                </div>
                <s.icon className={`${s.color} opacity-40`} size={20} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SEARCH/FILTER BAR */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-2xl p-3 mb-6 shrink-0 shadow-xl">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950/50 border border-slate-800 rounded-xl text-xs focus:outline-none focus:border-indigo-500/50 text-white transition-all"
            />
          </div>

          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950/50 border border-slate-800 rounded-xl text-xs appearance-none focus:outline-none focus:border-indigo-500/50 text-white"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
            <input
              type="text"
              placeholder="Filter by ID or Title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-950/50 border border-slate-800 rounded-xl text-xs focus:outline-none focus:border-indigo-500/50 text-white placeholder-slate-600"
            />
          </div>

          <button
            onClick={handleSearch}
            disabled={isSearching}
            className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all disabled:opacity-50"
          >
            {isSearching ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            SEARCH DATABASE
          </button>
        </div>
      </div>

      {/* NOTIFICATIONS */}
      {(error || lastUpdated) && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-center gap-2 shrink-0 animate-in fade-in slide-in-from-top-1 ${error ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          {error ? <AlertCircle size={14} /> : <CheckCircle2 size={14} />}
          {error || lastUpdated}
        </div>
      )}

      {/* DATA TABLE */}
      <div className="flex-1 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/20 backdrop-blur-md shadow-2xl">
        {filteredData.length > 0 ? (
          <div className="h-full overflow-y-auto">
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-900/95 backdrop-blur-md shadow-sm">
                  <th className="px-6 py-4 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">MC Number</th>
                  <th className="px-6 py-4 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Entity Title</th>
                  <th className="px-6 py-4 text-left text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Classification</th>
                  <th className="px-6 py-4 text-center text-[10px] uppercase tracking-widest font-bold text-slate-500 border-b border-slate-800">Date Decided</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/40">
                {filteredData.map((entry, idx) => (
                  <tr key={idx} className="group hover:bg-white/[0.02] transition-colors">
                    <td className="px-6 py-4 font-mono text-indigo-400 font-medium">{entry.number}</td>
                    <td className="px-6 py-4 text-slate-300 font-medium">{entry.title}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold border ${getCategoryColor(entry.category)}`}>
                        {entry.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-xs text-center font-mono">{entry.decided}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center space-y-3 opacity-30">
            <Database size={40} className="text-slate-500" />
            <p className="text-sm font-bold tracking-widest uppercase">No Records Found</p>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="mt-4 flex justify-between items-center shrink-0">
        <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">v2.1 Stable</p>
        <div className="flex gap-4 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
           <span>DB Status: Connected</span>
           <span>API: Ready</span>
        </div>
      </div>
    </div>
  );
};

export default FMCSARegister;
