import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

// Helper function to format date as DD-MMM-YY
function formatDateForFMCSA(date: Date): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

// Helper function to format date as MM/DD/YYYY
function formatDateToMMDDYYYY(dateStr: string): string {
  const [day, month, year] = dateStr.split('/');
  return `${month}/${day}/20${year}`;
}

interface FMCSAEntry {
  number: string;
  title: string;
  decided: string;
  category: string;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { date } = req.body;
    const registerDate = date || formatDateForFMCSA(new Date());
    const registerUrl = 'https://li-public.fmcsa.dot.gov/LIVIEW/PKG_register.prc_reg_detail';
    
    const params = new URLSearchParams();
    params.append('pd_date', registerDate);
    params.append('pv_vpath', 'LIVIEW');

    console.log(`[FMCSA] Fetching register data for date: ${registerDate}`);

    const response = await axios.post(registerUrl, params.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://li-public.fmcsa.dot.gov/LIVIEW/PKG_REGISTER.prc_reg_list',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Origin': 'https://li-public.fmcsa.dot.gov'
      },
      timeout: 60000,
    });

    if (!response.data.toUpperCase().includes('FMCSA REGISTER')) {
      return res.status(400).json({
        success: false,
        error: 'Invalid response from FMCSA',
        entries: []
      });
    }

    const $ = cheerio.load(response.data);
    
    // Category mapping with anchor names
    const categories: Record<string, { label: string; anchor: string }> = {
      'NC': { label: 'NAME CHANGE', anchor: 'NC' },
      'CPL': { label: 'CERTIFICATE, PERMIT, LICENSE', anchor: 'CPL' },
      'CX2': { label: 'CERTIFICATE OF REGISTRATION', anchor: 'CX2' },
      'DIS': { label: 'DISMISSAL', anchor: 'DIS' },
      'WDN': { label: 'WITHDRAWAL', anchor: 'WDN' },
      'REV': { label: 'REVOCATION', anchor: 'REV' },
      'TRN': { label: 'TRANSFERS', anchor: 'TRN' },
      'GDN': { label: 'GRANT DECISION NOTICES', anchor: 'GDN' }
    };

    const entries: FMCSAEntry[] = [];

    // Extract records using Sibling Logic for each category
    for (const [key, { label, anchor }] of Object.entries(categories)) {
      const startNode = $(`a[name="${anchor}"]`).first();
      if (!startNode.length) {
        console.log(`[FMCSA] Anchor not found for category: ${label}`);
        continue;
      }

      const targetTable = startNode.next('table');
      if (!targetTable.length) {
        console.log(`[FMCSA] Table not found for category: ${label}`);
        continue;
      }

      // Find all <th> tags with scope="row" (docket numbers)
      const docketHeaders = targetTable.find('th[scope="row"]');
      
      docketHeaders.each((index, element) => {
        const $th = $(element);
        const docketNo = $th.text().trim();
        
        // Get the next two <td> siblings (Title and Date)
        const $siblings = $th.nextAll('td');
        if ($siblings.length >= 2) {
          const title = $siblings.eq(0).text().trim();
          const decided = $siblings.eq(1).text().trim();

          if (docketNo && title && decided) {
            entries.push({
              number: docketNo,
              title: title,
              decided: decided,
              category: label
            });
          }
        }
      });

      console.log(`[FMCSA] Extracted ${docketHeaders.length} records for category: ${label}`);
    }

    // Remove duplicates
    const uniqueEntries = entries.filter((entry, index, self) =>
      index === self.findIndex((e) => e.number === entry.number && e.title === entry.title)
    );

    console.log(`[FMCSA] Total unique entries: ${uniqueEntries.length}`);

    return res.status(200).json({
      success: true,
      count: uniqueEntries.length,
      date: registerDate,
      lastUpdated: new Date().toISOString(),
      entries: uniqueEntries
    });

  } catch (error: any) {
    console.error('[FMCSA] Scrape error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to scrape FMCSA register data',
      details: error.message,
      entries: []
    });
  }
};
