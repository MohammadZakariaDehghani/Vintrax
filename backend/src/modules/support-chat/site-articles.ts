/**
 * What the site assistant knows about Vintrax: short articles, each written
 * from a page that exists in the web app. With a language model configured
 * they are its whole knowledge of the site; without one, the best-matching
 * article is the answer.
 *
 * Keep them to what the site does. An article that promises a feature, a fee
 * or a policy Vintrax does not have will be repeated to visitors as fact.
 */
export interface SiteArticle {
  id: string;
  title: string;
  href: string | null;
  keywords: string[];
  body: string;
}

export const SITE_ARTICLES: readonly SiteArticle[] = [
  {
    id: 'search',
    title: 'Find a car',
    href: '/vehicles',
    keywords: [
      'find',
      'search',
      'browse',
      'buy',
      'filter',
      'looking',
      'want',
      'suv',
      'truck',
      'sedan',
      'price',
      'budget',
      'under',
      'cheap',
      'inventory',
      'listing',
    ],
    body: [
      'Browse every car for sale at /vehicles.',
      '- Filter by make, model, year, price, mileage, body type, fuel, transmission, drivetrain, province and city.',
      '- Sort by newest, price or mileage, and switch between a list and a grid.',
      '- The home page has shortcuts by body type and by make.',
      'Open a car to see its photos, details, history and seller.',
    ].join('\n'),
  },
  {
    id: 'contact-seller',
    title: 'Contact a seller',
    href: null,
    keywords: [
      'contact',
      'message',
      'seller',
      'dealer',
      'phone',
      'call',
      'available',
      'question',
      'ask',
      'reach',
    ],
    body: [
      'On a car’s page, use the panel beside the photos:',
      '- Send message: your message goes to the seller, and replies appear under Dashboard → Messages.',
      '- Show phone number: shows the seller’s number, if they added one.',
      'You need a free Vintrax account for both. Sign in or register at /login.',
    ].join('\n'),
  },
  {
    id: 'finance',
    title: 'Financing and trade-ins',
    href: null,
    keywords: [
      'finance',
      'financing',
      'loan',
      'credit',
      'payment',
      'monthly',
      'lease',
      'approval',
      'approved',
      'interest',
      'rate',
      'apr',
      'trade',
      'tradein',
      'down',
    ],
    body: [
      'Many dealers take finance applications on Vintrax. On a car’s page, choose See finance & trade-in options.',
      '- Five short steps: your contact and income details, work and housing, a trade-in if you have one, your down payment and term, then a review.',
      '- The application goes only to that car’s seller, who arranges financing with their lenders.',
      '- Vintrax is not a lender: there is no credit check and no effect on your credit score, and Vintrax does not decide approvals or rates.',
      'Add your trade-in in step 3 and the dealer can put its value toward the car.',
    ].join('\n'),
  },
  {
    id: 'sell',
    title: 'Sell your car',
    href: '/register?role=SELLER',
    keywords: ['sell', 'selling', 'list', 'post', 'advertise', 'private', 'owner'],
    body: [
      'Private sellers can list a car on Vintrax:',
      '1. Create a seller account at /register?role=SELLER.',
      '2. Add the car with its details and photos.',
      '3. Each listing is reviewed before it goes live.',
      'Buyers then contact you through Vintrax messages.',
    ].join('\n'),
  },
  {
    id: 'dealer',
    title: 'Dealers on Vintrax',
    href: '/register?role=DEALER',
    keywords: [
      'dealer',
      'dealership',
      'business',
      'register',
      'partner',
      'lot',
      'feed',
      'import',
      'csv',
      'bulk',
    ],
    body: [
      'Dealerships register at /register?role=DEALER. Dealer accounts are verified by the Vintrax team.',
      'The dealer portal (/dealer/dashboard) lets a dealer:',
      '- add cars one at a time (starting from a VIN) or import a whole inventory from a CSV file;',
      '- manage prices, photos and status, track costs, and handle finance applications.',
    ].join('\n'),
  },
  {
    id: 'car-value',
    title: 'What is my car worth?',
    href: '/tools/car-value',
    keywords: ['worth', 'value', 'appraisal', 'estimate', 'valuation', 'how much'],
    body: 'The car value tool at /tools/car-value estimates what a car is worth from its year, make, model and mileage, and shows similar cars listed on Vintrax. It is an estimate to guide you, not an offer.',
  },
  {
    id: 'budget',
    title: 'What can I afford?',
    href: '/tools/budget',
    keywords: ['afford', 'budget', 'calculator', 'payment', 'monthly', 'spend'],
    body: 'The budget tool at /tools/budget works out a price range from the monthly payment you want, and links to cars on Vintrax in that range. The figures are estimates, not a loan offer.',
  },
  {
    id: 'auctions',
    title: 'Auctions',
    href: '/auctions',
    keywords: ['auction', 'bid', 'bidding', 'reserve', 'outbid', 'win'],
    body: [
      'Some cars are sold by live auction at /auctions.',
      '- Bidding needs a signed-in account with a verified email address.',
      '- You can follow your bids under Dashboard → My bids, and Vintrax tells you when you are outbid.',
    ].join('\n'),
  },
  {
    id: 'inspection',
    title: 'Inspections and vehicle history',
    href: null,
    keywords: [
      'inspection',
      'inspected',
      'history',
      'carfax',
      'accident',
      'condition',
      'report',
      'owners',
      'damage',
    ],
    body: [
      'A car’s page shows what its seller has shared about it:',
      '- an inspection report, when one was done;',
      '- a history timeline and a CARFAX badge or link, when the seller added them.',
      'Filter the search to inspected cars only. Always check a car in person before buying.',
    ].join('\n'),
  },
  {
    id: 'compare-save',
    title: 'Compare and save cars',
    href: '/compare',
    keywords: [
      'compare',
      'comparison',
      'save',
      'saved',
      'favourite',
      'favorite',
      'heart',
      'shortlist',
    ],
    body: [
      '- Save a car with the heart on its card or page; saved cars are under Dashboard → Saved.',
      '- Add up to four cars to Compare and see them side by side at /compare.',
    ].join('\n'),
  },
  {
    id: 'account',
    title: 'Your account',
    href: '/login',
    keywords: [
      'account',
      'sign',
      'login',
      'log',
      'register',
      'signup',
      'password',
      'email',
      'verify',
      'profile',
    ],
    body: [
      'Sign in or create a free account at /login. You need one to message sellers, save cars, bid and apply for financing.',
      'For trouble signing in, contact the Vintrax team through the Contact page (/contact).',
    ].join('\n'),
  },
  {
    id: 'contact-vintrax',
    title: 'Contact Vintrax',
    href: '/contact',
    keywords: [
      'help',
      'support',
      'team',
      'human',
      'person',
      'agent',
      'complaint',
      'problem',
      'report',
      'scam',
      'fraud',
      'contact',
    ],
    body: 'To reach the Vintrax team, use the form on the Contact page (/contact), or choose Talk to the team in this chat and someone will reply here.',
  },
  {
    id: 'safety',
    title: 'Buying safely',
    href: null,
    keywords: ['safe', 'safety', 'scam', 'fraud', 'deposit', 'wire', 'fake', 'trust'],
    body: [
      '- Keep conversations on Vintrax messages until you meet.',
      '- See the car in person, and have it inspected, before paying anything.',
      '- Be wary of anyone asking for a deposit by wire transfer or gift card.',
      'Report anything suspicious to the team through /contact.',
    ].join('\n'),
  },
];

const STOPWORDS = new Set(
  'a an the and or but is are was were be to of in on for with at by from it this that i me my we you your do does did can could would should how what when where which who why have has had there their them they so if any some not no yes please hi hello hey thanks thank'.split(
    ' ',
  ),
);

export function siteTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) =>
      word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word,
    )
    .filter((word) => word.length > 1 && !STOPWORDS.has(word));
}

const indexed = SITE_ARTICLES.map((article) => ({
  article,
  keywords: new Set(article.keywords.flatMap((keyword) => siteTokens(keyword))),
  title: new Set(siteTokens(article.title)),
}));

/** The articles that answer a question best, strongest first; a keyword hit is required. */
export function rankSiteArticles(question: string): SiteArticle[] {
  const words = [...new Set(siteTokens(question))];
  return indexed
    .map(({ article, keywords, title }) => {
      let score = 0;
      let hits = 0;
      for (const word of words) {
        if (keywords.has(word)) {
          score += 3;
          hits += 1;
        } else if (title.has(word)) score += 1;
      }
      return { article, score: hits > 0 ? score : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.article);
}
