import { supabase } from './supabaseClient';

export interface FMCSARegisterEntry {
  id?: string;
  number: string;
  title: string;
  decided: string;
  category: string;
  date_fetched: string;
  extracted_date?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Save FMCSA Register entries to Supabase with extracted_date
 */
export const saveFMCSARegisterEntries = async (
  entries: FMCSARegisterEntry[],
  fetchDate: string,
  extractedDate?: string
): Promise<{ success: boolean; error?: string; count?: number }> => {
  try {
    if (!entries || entries.length === 0) {
      console.log('ℹ️ No entries to save');
      return { success: true, count: 0 };
    }

    // Use extractedDate if provided, otherwise use fetchDate
    const dateToUse = extractedDate || fetchDate;

    // Prepare records for insertion
    const records = entries.map(entry => ({
      number: entry.number,
      title: entry.title,
      decided: entry.decided || 'N/A',
      category: entry.category || 'MISCELLANEOUS',
      date_fetched: fetchDate,
      extracted_date: dateToUse,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    console.log(`📝 Saving ${records.length} FMCSA Register entries for date: ${dateToUse}`);

    // Upsert to avoid duplicates
    const { data, error } = await supabase
      .from('fmcsa_register')
      .upsert(records, { onConflict: 'number,extracted_date' });

    if (error) {
      console.error('❌ Supabase save error:', error);
      return { success: false, error: `Database error: ${error.message}` };
    }

    console.log(`✅ Successfully saved ${records.length} entries with extracted_date: ${dateToUse}`);
    return { success: true, count: records.length };
  } catch (err: any) {
    console.error('❌ Exception saving FMCSA entries:', err);
    return { success: false, error: `Exception: ${err.message}` };
  }
};

/**
 * Fetch FMCSA Register entries by extracted_date (NO LIMIT)
 */
export const fetchFMCSARegisterByExtractedDate = async (
  extractedDate: string,
  filters?: {
    category?: string;
    searchTerm?: string;
  }
): Promise<FMCSARegisterEntry[]> => {
  try {
    let query = supabase
      .from('fmcsa_register')
      .select('*');

    // Filter by extracted_date
    query = query.eq('extracted_date', extractedDate);

    // Apply optional filters
    if (filters?.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    if (filters?.searchTerm) {
      const searchPattern = `%${filters.searchTerm}%`;
      query = query.or(
        `number.ilike.${searchPattern},title.ilike.${searchPattern}`
      );
    }

    // Order by number
    query = query.order('number', { ascending: true });

    // NO LIMIT - fetch all records for this date
    const { data, error } = await query;

    if (error) {
      console.error('❌ Supabase fetch error:', error);
      return [];
    }

    console.log(`✅ Fetched ${(data || []).length} FMCSA Register entries for date: ${extractedDate}`);
    return (data || []) as FMCSARegisterEntry[];
  } catch (err) {
    console.error('❌ Exception fetching from Supabase:', err);
    return [];
  }
};

/**
 * Fetch FMCSA Register entries from Supabase with filters (legacy - with limit)
 */
export const fetchFMCSARegisterEntries = async (filters?: {
  category?: string;
  dateFrom?: string;
  dateTo?: string;
  searchTerm?: string;
  limit?: number;
}): Promise<FMCSARegisterEntry[]> => {
  try {
    let query = supabase
      .from('fmcsa_register')
      .select('*');

    // Apply filters
    if (filters?.category && filters.category !== 'all') {
      query = query.eq('category', filters.category);
    }

    if (filters?.dateFrom) {
      query = query.gte('extracted_date', filters.dateFrom);
    }

    if (filters?.dateTo) {
      query = query.lte('extracted_date', filters.dateTo);
    }

    if (filters?.searchTerm) {
      const searchPattern = `%${filters.searchTerm}%`;
      query = query.or(
        `number.ilike.${searchPattern},title.ilike.${searchPattern}`
      );
    }

    // Order by date and number
    query = query
      .order('extracted_date', { ascending: false })
      .order('number', { ascending: true });

    // Apply limit
    if (filters?.limit) {
      query = query.limit(filters.limit);
    } else {
      query = query.limit(500); // Default limit for backward compatibility
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Supabase fetch error:', error);
      return [];
    }

    console.log(`✅ Fetched ${(data || []).length} FMCSA Register entries`);
    return (data || []) as FMCSARegisterEntry[];
  } catch (err) {
    console.error('❌ Exception fetching from Supabase:', err);
    return [];
  }
};

/**
 * Get entries for a specific date
 */
export const getFMCSAEntriesByDate = async (date: string): Promise<FMCSARegisterEntry[]> => {
  try {
    const { data, error } = await supabase
      .from('fmcsa_register')
      .select('*')
      .eq('extracted_date', date)
      .order('number', { ascending: true });

    if (error) {
      console.error('❌ Supabase fetch error:', error);
      return [];
    }

    console.log(`✅ Fetched ${(data || []).length} entries for date: ${date}`);
    return (data || []) as FMCSARegisterEntry[];
  } catch (err) {
    console.error('❌ Exception fetching entries by date:', err);
    return [];
  }
};

/**
 * Get unique categories
 */
export const getFMCSACategories = async (): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from('fmcsa_register')
      .select('category')
      .neq('category', null);

    if (error) {
      console.error('❌ Supabase fetch error:', error);
      return [];
    }

    // Extract unique categories
    const categories = new Set<string>();
    (data || []).forEach((record: any) => {
      if (record.category) {
        categories.add(record.category);
      }
    });

    return Array.from(categories).sort();
  } catch (err) {
    console.error('❌ Exception fetching categories:', err);
    return [];
  }
};

/**
 * Get statistics for a date range
 */
export const getFMCSAStatistics = async (
  dateFrom?: string,
  dateTo?: string
): Promise<{
  totalEntries: number;
  byCategory: Record<string, number>;
  dateRange: { from: string; to: string };
}> => {
  try {
    let query = supabase.from('fmcsa_register').select('*');

    if (dateFrom) {
      query = query.gte('extracted_date', dateFrom);
    }

    if (dateTo) {
      query = query.lte('extracted_date', dateTo);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ Supabase fetch error:', error);
      return {
        totalEntries: 0,
        byCategory: {},
        dateRange: { from: dateFrom || '', to: dateTo || '' },
      };
    }

    // Calculate statistics
    const byCategory: Record<string, number> = {};
    (data || []).forEach((entry: any) => {
      const cat = entry.category || 'UNCATEGORIZED';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    return {
      totalEntries: data?.length || 0,
      byCategory,
      dateRange: { from: dateFrom || '', to: dateTo || '' },
    };
  } catch (err) {
    console.error('❌ Exception fetching statistics:', err);
    return {
      totalEntries: 0,
      byCategory: {},
      dateRange: { from: dateFrom || '', to: dateTo || '' },
    };
  }
};

/**
 * Get all unique extracted dates
 */
export const getExtractedDates = async (): Promise<string[]> => {
  try {
    const { data, error } = await supabase
      .from('fmcsa_register')
      .select('extracted_date')
      .neq('extracted_date', null)
      .order('extracted_date', { ascending: false });

    if (error) {
      console.error('❌ Supabase fetch error:', error);
      return [];
    }

    // Extract unique dates
    const dates = new Set<string>();
    (data || []).forEach((record: any) => {
      if (record.extracted_date) {
        dates.add(record.extracted_date);
      }
    });

    return Array.from(dates).sort().reverse();
  } catch (err) {
    console.error('❌ Exception fetching dates:', err);
    return [];
  }
};

/**
 * Delete old entries (for cleanup)
 */
export const deleteFMCSAEntriesBeforeDate = async (date: string): Promise<{ success: boolean; error?: string; deleted?: number }> => {
  try {
    const { data, error } = await supabase
      .from('fmcsa_register')
      .delete()
      .lt('extracted_date', date);

    if (error) {
      console.error('❌ Supabase delete error:', error);
      return { success: false, error: error.message };
    }

    const deletedCount = (data || []).length;
    console.log(`✅ Deleted ${deletedCount} old entries`);
    return { success: true, deleted: deletedCount };
  } catch (err: any) {
    console.error('❌ Exception deleting entries:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Check if table exists and is accessible
 */
export const checkFMCSARegisterTable = async (): Promise<{
  exists: boolean;
  accessible: boolean;
  error?: string;
}> => {
  try {
    const { data, error } = await supabase
      .from('fmcsa_register')
      .select('*', { count: 'exact', head: true });

    if (error) {
      if (error.message.includes('does not exist')) {
        return {
          exists: false,
          accessible: false,
          error: 'fmcsa_register table does not exist',
        };
      }
      return {
        exists: false,
        accessible: false,
        error: error.message,
      };
    }

    return { exists: true, accessible: true };
  } catch (err: any) {
    return {
      exists: false,
      accessible: false,
      error: err.message,
    };
  }
};
