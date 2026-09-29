import {
  INVENTORY_CSV_VERSION,
  MAX_INVENTORY_CSV_BYTES,
  MAX_INVENTORY_CSV_ROWS,
  MAX_LISTING_IMAGES,
  REPAIR_COST_CATEGORIES,
  VEHICLE_COST_CATEGORIES,
  VEHICLE_COST_CATEGORY_LABELS,
} from '@vintrax/shared';

/**
 * What the dealer help assistant knows: how the dealer portal works, written
 * from the code, and nothing else.
 *
 * Each article describes a feature that exists. When a feature changes, its
 * article changes with it — the assistant has no other source, so an article
 * that drifts from the product is an assistant that gives wrong directions.
 * Anything not covered here is answered with the fallback, never guessed.
 *
 * The limits are read from `@vintrax/shared` rather than typed in, so the
 * numbers the assistant quotes are the numbers the API enforces.
 */
export interface HelpArticle {
  id: string;
  title: string;
  /** The portal page the article is about, if there is one. */
  href: string | null;
  /** Words a dealer might use for this topic. Matched after light normalising. */
  keywords: string[];
  /** Plain text, short paragraphs and "- " bullets. Shown as-is without a model. */
  body: string;
}

const csvMegabytes = MAX_INVENTORY_CSV_BYTES / (1024 * 1024);
const repairLabels = REPAIR_COST_CATEGORIES.map((c) => VEHICLE_COST_CATEGORY_LABELS[c]).join(', ');
const categoryLabels = VEHICLE_COST_CATEGORIES.map((c) => VEHICLE_COST_CATEGORY_LABELS[c]).join(
  ', ',
);

export const HELP_ARTICLES: readonly HelpArticle[] = [
  {
    id: 'add-vehicle',
    title: 'Add a vehicle',
    href: '/dealer/add-vehicle',
    keywords: [
      'add',
      'new',
      'create',
      'list',
      'listing',
      'post',
      'vehicle',
      'car',
      'form',
      'vin',
      'decode',
    ],
    body: [
      'Go to Inventory and choose "Add vehicle" (or open /dealer/add-vehicle).',
      'Type the 17-character VIN. Vintrax checks it and fills in the make, model, year, trim, body style and drivetrain; choose "Next". No VIN? Use the "Make & Model" tab, or "Add the car manually".',
      'The form is one page of sections with a timeline on the left: a tick means done, a red "!" means something required is missing. Required: brand, model, year, body style, a VIN or stock number, province and city, condition and mileage, fuel, drive and transmission, a description (20 characters or more) and the asking price.',
      'Tick the equipment the vehicle has, pick the colours, and add owners, damage, warranty and power if you know them.',
      `Add up to ${MAX_LISTING_IMAGES} photos by choosing them or dragging them in. The first photo is the main photo. You can also add a YouTube video link.`,
      'Sale, MSRP, invoice, retail and wholesale prices are for your records only; buyers see the asking price.',
      'Choose "Save as draft" to keep it private, or "Publish" to send it to Vintrax for review. It goes live once an administrator approves it.',
      'To add many vehicles at once, use a CSV upload instead.',
    ].join('\n'),
  },
  {
    id: 'edit-vehicle',
    title: 'Edit a vehicle',
    href: '/dealer/inventory',
    keywords: ['edit', 'change', 'update', 'modify', 'fix', 'details', 'description', 'price'],
    body: [
      'In Inventory, find the vehicle (search by VIN, stock number, make or model) and click its row: a panel opens with its details, price, listing quality and actions. Choose "Edit" there, or the pencil in the row, to open /dealer/inventory/<vehicle> with the full form.',
      'Change what you need and choose "Save changes". A draft also has "Publish".',
      'On the same page you can set the vehicle history badges, the CARFAX link and the accident timeline.',
      'A price change keeps the previous price, which buyers see struck through.',
      'While a vehicle is in a running auction its price and reserve cannot be changed.',
    ].join('\n'),
  },
  {
    id: 'photos',
    title: 'Manage vehicle photos',
    href: '/dealer/inventory',
    keywords: ['photo', 'photos', 'picture', 'image', 'main', 'order', 'reorder', 'drag', 'cover'],
    body: [
      'Open the vehicle with "Edit". In the photos section:',
      '- Upload photos from your computer or phone.',
      '- Drag a photo to change the order, or use its arrow buttons.',
      '- "Make main" moves a photo to the front. The first photo is the main photo, labelled "Main photo".',
      '- The × button removes a photo.',
      `A listing can have up to ${MAX_LISTING_IMAGES} photos. Save the form to keep the new order.`,
    ].join('\n'),
  },
  {
    id: 'search-inventory',
    title: 'Search, filter and sort your inventory',
    href: '/dealer/inventory',
    keywords: ['search', 'find', 'filter', 'sort', 'vin', 'stock', 'make', 'model', 'year', 'look'],
    body: [
      'Inventory (/dealer/inventory) lists only your own vehicles, including drafts.',
      '- Search by VIN, stock number, make, model, trim or year. Several words narrow the search.',
      '- Filter by status, make, model, year range, price range and source (added by hand or CSV import).',
      '- Sort by last updated, price, year, mileage or date added.',
      'The page size can be 10, 20, 50 or 100 per page.',
    ].join('\n'),
  },
  {
    id: 'delete-vehicle',
    title: 'Delete vehicles',
    href: '/dealer/inventory',
    keywords: ['delete', 'remove', 'erase', 'bulk', 'trash', 'get', 'rid'],
    body: [
      'To delete one vehicle, choose "Delete" in its row and confirm.',
      'To delete several, tick them (or use "Select all"), then choose "Delete" in the bar that appears and confirm.',
      'Deleting is permanent. Two kinds of vehicle cannot be deleted:',
      '- a vehicle in a live or scheduled auction: cancel the auction first;',
      '- a vehicle marked sold: archive it instead, so the sale stays on record.',
      'In a bulk delete, those vehicles are reported and left as they are; the rest are deleted.',
    ].join('\n'),
  },
  {
    id: 'status',
    title: 'Change a vehicle’s status',
    href: '/dealer/inventory',
    keywords: [
      'status',
      'publish',
      'unpublish',
      'live',
      'active',
      'draft',
      'review',
      'approve',
      'sold',
      'archive',
      'archived',
      'visible',
      'hide',
      'mark',
    ],
    body: [
      'Statuses: Draft (private), Pending review (waiting for Vintrax to approve), Active (live), In auction, Sold, Archived.',
      'You can make these moves yourself:',
      '- Draft → Pending review, Archived or Sold',
      '- Pending review → Draft or Sold',
      '- Active → Draft (unpublish), Archived or Sold',
      '- Archived → Draft or Sold',
      '- Sold → Draft (if the sale fell through)',
      'A listing becomes Active only when an administrator approves it. A vehicle in a running auction cannot change status until the auction is cancelled.',
      'To change several at once, tick them and use "Change status" in the selection bar. Vehicles that cannot make the move are reported and left unchanged.',
    ].join('\n'),
  },
  {
    id: 'csv-upload',
    title: 'Upload inventory with a CSV file',
    href: '/dealer/inventory/import',
    keywords: [
      'csv',
      'upload',
      'import',
      'bulk',
      'spreadsheet',
      'excel',
      'file',
      'template',
      'feed',
      'dms',
    ],
    body: [
      'In Inventory choose "Upload CSV" (or open /dealer/inventory/import).',
      '1. Download the template if you need the column layout. Exporting your current inventory gives a file in the same format, ready to edit and re-upload.',
      '2. Choose your CSV file. Nothing is changed yet: Vintrax checks every row and shows a preview of what would be created, updated, left unchanged or skipped, with the errors and warnings for each row.',
      '3. If your file has no city or province, set a location for the import; it is used only for rows that do not give one.',
      '4. Choose to import. Valid rows are written; rows with errors are skipped and listed.',
      'Rows are matched to your vehicles by VIN first, then by stock number. Matches are updated, everything else is created as a draft. Only your own inventory is ever matched or changed.',
      `Limits: ${csvMegabytes} MB and ${MAX_INVENTORY_CSV_ROWS.toLocaleString('en-CA')} rows per file (template version ${INVENTORY_CSV_VERSION}).`,
      'Photo URLs in the file are downloaded in the background after the import; progress shows under Recent imports.',
    ].join('\n'),
  },
  {
    id: 'csv-errors',
    title: 'Why a CSV upload failed',
    href: '/dealer/inventory/import',
    keywords: [
      'csv',
      'fail',
      'failed',
      'error',
      'errors',
      'wrong',
      'skipped',
      'invalid',
      'rejected',
      'why',
      'problem',
      'upload',
      'import',
      'duplicate',
      'utf',
    ],
    body: [
      'The preview lists every problem by row number. The common ones:',
      '- Missing VIN: a row with neither a VIN nor a stock number is skipped. A row with a stock number but no VIN is imported with a warning.',
      '- Invalid VIN: a VIN must be 17 characters and cannot contain the letters I, O or Q.',
      '- Duplicate VIN or stock number: the same VIN or stock number appears on more than one row of the file.',
      '- Invalid year, price or mileage: the year must be a real model year, the price a whole number of dollars of at least 1, and the mileage between 0 and 2,000,000 km.',
      '- Missing required fields for a new vehicle: year, make, model, price, mileage, condition, body type, transmission, fuel type, drivetrain, city and province.',
      '- Invalid status: the listing_status column may be DRAFT, PENDING_REVIEW, SOLD or ARCHIVED; any other value is an error. ACTIVE or IN_AUCTION from an export is left unchanged with a warning, because publishing needs approval.',
      `- The whole file is refused if it is empty, larger than ${csvMegabytes} MB, over ${MAX_INVENTORY_CSV_ROWS.toLocaleString('en-CA')} rows, or not saved as UTF-8. In Excel, use "Save as → CSV UTF-8".`,
      'Fix the rows in your spreadsheet and upload the file again. Rows already imported are reported as unchanged, not duplicated.',
    ].join('\n'),
  },
  {
    id: 'export',
    title: 'Export inventory to CSV',
    href: '/dealer/inventory',
    keywords: ['export', 'download', 'csv', 'backup', 'spreadsheet', 'excel'],
    body: [
      'To export everything, open "Upload CSV" (or /dealer/inventory/import) and choose "Export current inventory".',
      'To export only some vehicles, tick them in Inventory and choose "Export CSV" in the selection bar.',
      'The export uses the same columns as the import, so you can edit it and upload it again. Costs are not included in the export.',
    ].join('\n'),
  },
  {
    id: 'costs-add',
    title: 'Add a vehicle cost',
    href: '/dealer/costs',
    keywords: [
      'cost',
      'costs',
      'expense',
      'add',
      'record',
      'repair',
      'purchase',
      'fee',
      'invoice',
      'reconditioning',
      'recon',
      'spent',
      'paid',
    ],
    body: [
      'Open Costs (/dealer/costs) and choose a vehicle, or choose "Costs" on the vehicle’s row in Inventory.',
      'Choose "+ Add cost" and fill in the category, amount and date. Description, vendor, reference or invoice number and notes are optional.',
      `Categories: ${categoryLabels}.`,
      'A vehicle can have as many cost entries as you need. Use the edit and delete buttons on an entry to change or remove it.',
      'Costs are private to your dealership. Buyers and other dealers never see them.',
    ].join('\n'),
  },
  {
    id: 'costs-total',
    title: 'See the total cost of a vehicle',
    href: '/dealer/costs',
    keywords: [
      'total',
      'cost',
      'costs',
      'overview',
      'sum',
      'how',
      'much',
      'where',
      'see',
      'report',
    ],
    body: [
      'Each vehicle’s cost page shows its total purchase cost, total additional costs (everything except the purchase), total cost, current asking price and estimated gross margin.',
      'The Costs overview (/dealer/costs) lists every vehicle with its purchase cost, additional costs, total cost, price and gross margin, and shows the totals across your inventory: total inventory cost, total repair cost, total other costs and average cost per vehicle. Switch between In stock, Sold and All vehicles.',
      `Repair costs are ${repairLabels}. Other costs are everything that is neither the purchase nor a repair.`,
      'The Inventory page also shows each vehicle’s total cost in the Cost column.',
    ].join('\n'),
  },
  {
    id: 'gross-margin',
    title: 'How gross margin is calculated',
    href: '/dealer/costs',
    keywords: ['margin', 'gross', 'profit', 'calculate', 'calculated', 'formula', 'earn', 'make'],
    body: [
      'Gross margin = the vehicle’s price − its total recorded cost.',
      'Total cost is the sum of every cost entry on the vehicle, including the purchase cost.',
      'It is an estimate, not profit: it uses the listed price and leaves out overheads, commissions and taxes. A vehicle with no costs recorded shows no margin.',
      'The average gross margin on the Costs overview is the mean over vehicles that have at least one cost.',
    ].join('\n'),
  },
  {
    id: 'dashboard',
    title: 'Understanding the dashboards',
    href: '/dealer/dashboard',
    keywords: [
      'dashboard',
      'stats',
      'statistics',
      'numbers',
      'cards',
      'value',
      'views',
      'enquiries',
      'analytics',
      'understand',
      'mean',
      'chart',
    ],
    body: [
      'The Inventory page’s cards count your vehicles: Total inventory, Active, Sold, Draft, and Total inventory value (the asking prices of vehicles not sold or archived).',
      'The Dealer dashboard (/dealer/dashboard) shows active listings and drafts, vehicles sold this month, gross sales this month (the prices of vehicles marked sold), total views and enquiries, charts of listings and sales, and your most viewed vehicles.',
      'The Costs overview’s cards are total inventory cost, total repair cost, total other costs and average cost per vehicle.',
      'Every number is calculated from your own vehicles only.',
    ].join('\n'),
  },
  {
    id: 'duplicate',
    title: 'Duplicate a vehicle',
    href: '/dealer/inventory',
    keywords: ['duplicate', 'copy', 'clone', 'similar', 'same'],
    body: [
      'Choose "Duplicate" in a vehicle’s row to create a new draft with the same specification, price, description, features and photos.',
      'The VIN, stock number, documents, history, inspections and costs are not copied, because they belong to the original car. Add the new car’s VIN and stock number, then save.',
    ].join('\n'),
  },
  {
    id: 'auction',
    title: 'Run an auction',
    href: '/dealer/inventory',
    keywords: ['auction', 'bid', 'bids', 'bidding', 'reserve'],
    body: [
      'Choose "Run auction" on a vehicle’s row in Inventory to set up an auction for it.',
      'While the auction is running, the vehicle cannot be deleted, change status, or have its price or reserve changed. Cancel the auction first if you need to.',
    ].join('\n'),
  },
  {
    id: 'support',
    title: 'Contact Vintrax support',
    href: '/contact',
    keywords: ['contact', 'support', 'help', 'human', 'person', 'phone', 'email', 'call', 'talk'],
    body: [
      'Open the Contact page (/contact). It has Vintrax’s phone number, email address and hours, and a form that sends your message to the team.',
    ].join('\n'),
  },
  {
    id: 'dealer-profile',
    title: 'Your dealership profile',
    href: '/contact',
    keywords: [
      'profile',
      'dealership',
      'dealer',
      'account',
      'business',
      'name',
      'logo',
      'verify',
      'verified',
      'verification',
      'settings',
      'licence',
      'license',
    ],
    body: [
      'Your dealership’s name and details are set when the dealer account is registered, and Vintrax verifies the dealership. Until it is verified you can still prepare listings.',
      'The dealer portal does not yet have a page to edit the dealership profile. To change your dealership’s name, logo, licence number or other details, contact Vintrax support through the Contact page (/contact).',
    ].join('\n'),
  },
];

// --- Matching ------------------------------------------------------------------

const STOPWORDS = new Set(
  (
    'a an and are as at be can do does for from how i in is it me my of on or so that the this ' +
    'to what when where which who why will with you your we our there their its'
  ).split(' '),
);

/** Words that mean the same thing to this knowledge base. */
const SYNONYMS: Record<string, string> = {
  pic: 'photo',
  pics: 'photo',
  picture: 'photo',
  image: 'photo',
  img: 'photo',
  spreadsheet: 'csv',
  excel: 'csv',
  xlsx: 'csv',
  erase: 'delete',
  remove: 'delete',
  trash: 'delete',
  expense: 'cost',
  expenses: 'cost',
  spend: 'cost',
  spent: 'cost',
  modify: 'edit',
  change: 'edit',
  update: 'edit',
  profit: 'margin',
  stock: 'stock',
  inventory: 'inventory',
  cars: 'car',
  vehicles: 'vehicle',
  license: 'licence',
};

export function normaliseWord(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  const direct = SYNONYMS[w];
  if (direct) return direct;
  // Light plural stripping: "costs" → "cost", "photos" → "photo".
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return SYNONYMS[w] ?? w;
}

export function tokens(text: string): string[] {
  return text
    .split(/[^A-Za-z0-9]+/)
    .map(normaliseWord)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

export interface ScoredArticle {
  article: HelpArticle;
  score: number;
}

const indexed = HELP_ARTICLES.map((article) => ({
  article,
  keywords: new Set(article.keywords.map(normaliseWord)),
  title: new Set(tokens(article.title)),
  body: new Set(tokens(article.body)),
}));

/**
 * Ranks the articles for a question. A keyword hit counts most, a title word
 * next, a body word least; the page the dealer is on breaks ties towards the
 * article about that page.
 */
export function rankArticles(question: string, page?: string): ScoredArticle[] {
  const words = [...new Set(tokens(question))];
  if (words.length === 0) return [];

  return indexed
    .map(({ article, keywords, title, body }) => {
      let score = 0;
      let keywordHits = 0;
      for (const word of words) {
        if (keywords.has(word)) {
          score += 3;
          keywordHits += 1;
        } else if (title.has(word)) score += 2;
        else if (body.has(word)) score += 0.5;
      }
      // Without a single keyword the match is a coincidence of common words.
      if (keywordHits === 0) score = 0;
      if (score > 0 && page && article.href && page.startsWith(article.href)) score += 0.5;
      return { article, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** The lowest score an article needs to be offered as the answer on its own. */
export const MIN_ANSWER_SCORE = 3;
