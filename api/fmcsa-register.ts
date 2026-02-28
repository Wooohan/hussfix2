import { VercelRequest, VercelResponse } from '@vercel/node';
import axios from 'axios';
import * as cheerio from 'cheerio';

// Helper to format date if none provided
function formatDateForFMCSA(date: Date): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(date.getDate()).padStart(2, '0');
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  return `${day}-${month}-${year}`;
}

export default async (req: VercelRequest, res: VercelResponse) => {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { date } = req.body;
    const registerDate = date || formatDateForFMCSA(new Date());
    const registerUrl = 'https://li-public.fmcsa.dot.gov/LIVIEW/PKG_register.prc_reg_detail';
    
    // 2. Prepare Form Data
    const params = new URLSearchParams();
    params.append('pd_date', registerDate);
    params.append('pv_vpath', 'LIVIEW');

    // 3. Fetch HTML
    const response = await axios.post(registerUrl, params.toString(), {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    const allEntries: any[] = [];

    // 4. Map Categories to their HTML Anchor Names
    const categories = [
      { name: 'NAME CHANGE', anchor: 'NC' },
      { name: 'CERTIFICATE, PERMIT, LICENSE', anchor: 'CPL' },
      { name: 'CERTIFICATE OF REGISTRATION', anchor: 'CX2' },
      { name: 'DISMISSAL', anchor: 'DIS' },
      { name: 'WITHDRAWAL', anchor: 'WDN' },
      { name: 'REVOCATION', anchor: 'REV' }
    ];

    // 5. Loop through each section
    categories.forEach((cat) => {
      // Find the <a> tag with the name attribute (e.g., <a name="NC">)
      const sectionAnchor = $(`a[name="${cat.anchor}"]`);
      
      if (sectionAnchor.length > 0) {
        // Find the table that follows this anchor
        // FMCSA structure usually places the data in the very next table
        const targetTable = sectionAnchor.closest('table').nextAll('table').first();

        // 6. FIX: Use Sibling Logic to bypass missing <tr> tags
        // We find every <th> with scope="row" as the anchor for a record
        targetTable.find('th[scope="row"]').each((_, el) => {
          const docket = $(el).text().trim();
          
          // Get the next two <td> siblings (Title/Location and the Date)
          const titleCell = $(el).next('td');
          const dateCell = titleCell.next('td');

          if (docket && titleCell.length > 0) {
            allEntries.push({
              number: docket,
              title: titleCell.text().replace(/\s+/g, ' ').trim(),
              date: dateCell.text().trim(),
              category: cat.name // Category is explicitly assigned here
            });
          }
        });
      }
    });

    // 7. Remove Duplicates (if any)
    const uniqueEntries = allEntries.filter((entry, index, self) =>
      index === self.findIndex((e) => e.number === entry.number && e.title === entry.title)
    );

    return res.status(200).json({
      success: true,
      count: uniqueEntries.length,
      date: registerDate,
      entries: uniqueEntries
    });

  } catch (error: any) {
    console.error('Scrape Error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to scrape FMCSA data',
      details: error.message
    });
  }
};
