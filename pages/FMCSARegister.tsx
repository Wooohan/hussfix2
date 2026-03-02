import React, { useState, useEffect } from 'react';
import { FileText, RefreshCw, Calendar, Search, Filter, ChevronDown, ExternalLink, AlertCircle, X, Database, CheckCircle2, TrendingUp, BarChart3 } from 'lucide-react';
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

  // Get today's date in YYYY-MM-DD format
  function getTodayDate(): string {
    const today = new Date();
    return today.toISOString().split('T')[0];
  }

  // Convert YYYY-MM-DD to DD-MMM-YY format for API
  function formatDateForAPI(dateStr: string): string {
    const date = new Date(dateStr + 'T00:00:00Z');
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = months[date.getUTCMonth()];
    const year = String(date.getUTCFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  }

  // Load available dates on component mount
  useEffect(() => {
    loadAvailableDates();
  }, []);

  // Calculate category statistics
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

  // Search button - fetch data from database by extracted_date.
  const handleSearch = async () => {
    setIsSearching(true);
    setError('');
    
    try {
      console.log(`🔍 Searching for data with extracted_date: ${selectedDate}`);
      
      const data = await fetchFMCSARegisterByExtractedDate(selectedDate, {
        category: selectedCategory !== 'all' ? selectedCategory : undefined,
        searchTerm: searchTerm || undefined
      });
      
      if (data && data.length > 0) {
        setRegisterData(data);
        setLastUpdated(`✅ Loaded ${data.length} records from database for ${selectedDate}`);
        console.log(`✅ Successfully loaded ${data.length} records`);
      } else {
        setRegisterData([]);
        setLastUpdated('');
        setError(`No data found in database for date: ${selectedDate}. Click "Fetch Live" to scrape from FMCSA.`);
      }
    } catch (err) {
      console.error('Search error:', err);
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
      
      // Smart detection for Local vs Production
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiUrl = isLocal ? 'http://localhost:3001/api/fmcsa-register' : '/api/fmcsa-register';
      
      console.log(`🚀 Fetching live FMCSA data for: ${formattedDate}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          date: formattedDate
        })
      });
      
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Server returned ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data.success && data.entries && data.entries.length > 0) {
        setRegisterData(data.entries);
        setLastUpdated(`Live: ${new Date().toLocaleTimeString()} (${data.count} records)`);
        
        // Auto-save to Supabase with extracted_date
        saveToSupabase(data.entries, selectedDate);
        
        // Reload available dates
        loadAvailableDates();
      } else {
        throw new Error('No entries found on FMCSA for this date.');
      }
    } catch (err: any) {
      console.error('Error fetching FMCSA register:', err);
      setError(err.message || 'Unable to fetch live register data.');
    } finally {
      setIsLoading(false);
    }
  };

  const saveToSupabase = async (entries: FMCSARegisterEntry[], extractedDate: string) => {
    setSaveStatus('saving');
    try {
      console.log(`💾 Saving ${entries.length} entries with extracted_date: ${extractedDate}`);
      
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
      console.error('Save error:', err);
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
      'NAME CHANGE': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      'CERTIFICATE, PERMIT, LICENSE': 'bg-green-500/20 text-green-400 border-green-500/30',
      'CERTIFICATE OF REGISTRATION': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      'DISMISSAL': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
      'WITHDRAWAL': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
      'REVOCATION': 'bg-red-500/20 text-red-400 border-red-500/30',
      'MISCELLANEOUS': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
      'TRANSFERS': 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
      'GRANT DECISION NOTICES': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    };
    return colors[category] || 'bg-slate-500/20 text-slate-400 border-slate-500/30';
  };

  const getCategoryBgColor = (category: string) => {
    const colors: Record<string, string> = {
      'NAME CHANGE': 'from-blue-600/20 to-blue-900/10 border-blue-500/20',
      'CERTIFICATE, PERMIT, LICENSE': 'from-green-600/20 to-green-900/10 border-green-500/20',
      'CERTIFICATE OF REGISTRATION': 'from-purple-600/20 to-purple-900/10 border-purple-500/20',
      'DISMISSAL': 'from-yellow-600/20 to-yellow-900/10 border-yellow-500/20',
      'WITHDRAWAL': 'from-orange-600/20 to-orange-900/10 border-orange-500/20',
      'REVOCATION': 'from-red-600/20 to-red-900/10 border-red-500/20',
      'MISCELLANEOUS': 'from-slate-600/20 to-slate-900/10 border-slate-500/20',
      'TRANSFERS': 'from-indigo-600/20 to-indigo-900/10 border-indigo-500/20',
      'GRANT DECISION NOTICES': 'from-emerald-600/20 to-emerald-900/10 border-emerald-500/20',
    };
    return colors[category] || 'from-slate-600/20 to-slate-900/10 border-slate-500/20';
  };

  return (
    <div className="p-6 h-screen flex flex-col overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-200 font-sans">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-600 to-indigo-700 rounded-lg">
              <FileText className="text-white" size={24} />
            </div>
            FMCSA Register
          </h1>
          <p className="text-slate-400 text-sm mt-1">Daily Motor Carrier Decisions & Notices</p>
        </div>
        <div className="flex items-center gap-3">
          {saveStatus === 'saving' && <span className="text-xs text-slate-500 animate-pulse flex items-center gap-1"><Database size={12}/> Syncing...</span>}
          {saveStatus === 'saved' && <span className="text-xs text-green-500 flex items-center gap-1"><CheckCircle2 size={12}/> Synced</span>}
          <button
            onClick={fetchRegisterData}
            disabled={isLoading}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white rounded-lg text-sm font-semibold transition-all shadow-lg shadow-indigo-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Scraping...' : 'Fetch Live'}
          </button>
        </div>
      </div>

      {/* Stats Row */}
      {registerData.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold">Total Records</p>
                <p className="text-2xl font-bold text-white mt-1">{registerData.length}</p>
              </div>
              <TrendingUp className="text-indigo-500 opacity-20" size={32} />
            </div>
          </div>
          <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold">Categories</p>
                <p className="text-2xl font-bold text-white mt-1">{Object.keys(categoryStats).length}</p>
              </div>
              <BarChart3 className="text-green-500 opacity-20" size={32} />
            </div>
          </div>
          <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold">Top Category</p>
                <p className="text-lg font-bold text-white mt-1">
                  {Object.entries(categoryStats).length > 0 
                    ? Object.entries(categoryStats).sort(([,a], [,b]) => b - a)[0][0]
                    : 'N/A'}
                </p>
              </div>
              <Filter className="text-purple-500 opacity-20" size={32} />
            </div>
          </div>
          <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 rounded-lg p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider font-semibold">Filtered</p>
                <p className="text-2xl font-bold text-white mt-1">{filteredData.length}</p>
              </div>
              <Search className="text-orange-500 opacity-20" size={32} />
            </div>
          </div>
        </div>
      )}

      {/* Controls Section */}
      <div className="bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 rounded-lg p-4 backdrop-blur-sm mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Date Picker */}
          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            />
            {availableDates.length > 0 && (
              <p className="text-xs text-slate-500 mt-1">
                Available: {availableDates.length} dates
              </p>
            )}
          </div>

          {/* Category Filter */}
          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">Category</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50"
            >
              <option value="all">All Categories</option>
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>

          {/* Search Term */}
          <div>
            <label className="block text-xs uppercase tracking-wider font-semibold text-slate-400 mb-2">Search</label>
            <input
              type="text"
              placeholder="Search by number or title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-3 py-2 bg-slate-900/50 border border-slate-600/50 rounded-lg text-white text-sm focus:outline-none focus:border-indigo-500/50 placeholder-slate-500"
            />
          </div>

          {/* Search Button */}
          <div className="flex items-end">
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-500 hover:to-green-600 text-white rounded-lg text-sm font-semibold transition-all shadow-lg shadow-green-900/30 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Search size={16} className={isSearching ? 'animate-spin' : ''} />
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>
      </div>

      {/* Status Message */}
      {lastUpdated && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400 text-sm flex items-center gap-2">
          <CheckCircle2 size={16} />
          {lastUpdated}
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Data Table */}
      <div className="flex-1 overflow-hidden rounded-lg border border-slate-700/50 bg-slate-900/20 backdrop-blur-sm">
        {filteredData.length > 0 ? (
          <div className="h-full overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900/80 border-b border-slate-700/50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Number</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Title</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Category</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Decided</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-300">Extracted Date</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((entry, idx) => (
                  <tr key={idx} className="border-b border-slate-700/30 hover:bg-slate-800/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-indigo-400">{entry.number}</td>
                    <td className="px-4 py-3 text-slate-300">{entry.title}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-1 rounded text-xs font-semibold border ${getCategoryColor(entry.category)}`}>
                        {entry.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{entry.decided}</td>
                    <td className="px-4 py-3 text-slate-400">{entry.extracted_date || 'N/A'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <AlertCircle className="mx-auto mb-3 text-slate-500" size={40} />
              <p className="text-slate-400">No data found</p>
              <p className="text-slate-500 text-sm mt-1">
                {registerData.length === 0 
                  ? 'Select a date and click "Search" to load data from database'
                  : 'No results match your filters'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default FMCSARegister;
