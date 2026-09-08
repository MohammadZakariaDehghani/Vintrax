/**
 * English and French copy for the site chrome.
 *
 * A hand-written typed dictionary rather than an i18n framework: the strings
 * here are the application's own furniture — navigation, buttons, form labels,
 * empty states. Listings, descriptions and messages are written by sellers and
 * are shown in whatever language they were written in, because machine
 * translation of a vehicle's condition is a liability, not a feature.
 *
 * `Dictionary` is derived from the English object, so a missing French key is a
 * compile error rather than an English word appearing mid-sentence.
 */
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  fr: 'Français',
};

const en = {
  brand: {
    descriptor: "Canada's auto marketplace",
    tagline:
      'A Canadian vehicle marketplace connecting buyers with dealerships and private sellers, with live auctions and independent inspection reports.',
  },

  home: {
    heroTitle: 'Find your next vehicle, without the pressure',
    heroBody:
      'Browse dealer inventory and private listings across Canada, bid in live auctions, and buy with an independent inspection report in hand.',
    quickSuvs: 'SUVs',
    quickTrucks: 'Trucks',
    quickElectric: 'Electric',
    quickUnder: 'Under $30,000',
    quickInspected: 'Inspected',
    shopByType: 'Browse by body type',
    popularMakes: 'Popular makes',
    closingSoon: 'Closing soon',
    closingSoonBody: 'Live auctions accepting bids now.',
    recentlyListed: 'Recently listed',
    available: 'vehicles available',
    freshInventory: 'Fresh inventory',
    browseAll: 'Browse all',
    inventoryLoading: 'Inventory is loading. If this persists, the API may not be running.',
    inspectionsTitle: 'Independent inspections',
    inspectionsBody:
      'Condition reports graded section by section, with structural damage disclosed up front.',
    auctionsTitle: 'Transparent auctions',
    auctionsBody:
      'Live bidding with anti-snipe extensions, so a lot cannot be won in the final seconds.',
    sellersTitle: 'Dealers and private sellers',
    sellersBody:
      'Verified dealership inventory alongside private listings, in one searchable marketplace.',
    sellingTitle: 'Selling a vehicle?',
    sellingBody:
      'List it at a fixed price or run it through auction. Dealers get inventory tools, analytics and lead management; private sellers get a guided listing flow.',
    sellCta: 'Sell your vehicle',
    dealerCta: 'Register as a dealer',
    priceRange: 'Current inventory ranges from',
    priceRangeTo: 'to',
  },

  nav: {
    browse: 'Browse',
    auctions: 'Auctions',
    dashboard: 'Dashboard',
    inventory: 'Inventory',
    admin: 'Admin',
    saved: 'Saved',
    messages: 'Messages',
    notifications: 'Notifications',
    menu: 'Menu',
    close: 'Close',
  },

  auth: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    createAccount: 'Create account',
    email: 'Email',
    password: 'Password',
    firstName: 'First name',
    lastName: 'Last name',
    signInTitle: 'Sign in',
    signInSubtitle: 'Welcome back. Sign in to bid, save vehicles and message sellers.',
    registerTitle: 'Create your account',
    registerSubtitle: 'One account for buying, selling and bidding.',
    noAccount: 'New to Atlas?',
    haveAccount: 'Already have an account?',
    invalidCredentials: 'That email and password do not match an account.',
    passwordHint:
      'At least 10 characters, with upper and lower case, a number and a symbol.',
    iWantTo: 'I want to',
    dealershipName: 'Dealership name',
    businessNumber: 'Business number (optional)',
    province: 'Province (optional)',
    city: 'City (optional)',
  },

  search: {
    placeholder: 'Make, model or keyword',
    heroLabel: 'Search vehicles by make, model or keyword',
    heroPlaceholder: 'Try “RAV4”, “electric AWD” or “F-150”',
    browseLabel: 'Search vehicles',
    browsePlaceholder: 'Search by make, model, colour or keyword',
    searching: 'Searching…',
    forQuery: 'for',
    clearAll: 'Clear all filters',
    noMatchTitle: 'No vehicles match those filters',
    noMatchHelp: 'Try widening your price or year range, or removing a filter.',
    submit: 'Search',
    anyMake: 'Any make',
    anyProvince: 'Anywhere in Canada',
    anyPrice: 'Any price',
    makeLabel: 'Make',
    modelLabel: 'Model',
    modelPlaceholder: 'e.g. RAV4',
    maxPriceLabel: 'Max price',
    provinceLabel: 'Province',
    advanced: 'All filters',
    filters: 'Filters',
    clearFilters: 'Clear filters',
    resultsOne: 'vehicle',
    resultsOther: 'vehicles',
    noResults: 'No matches',
    noResultsHelp: 'Try fewer filters, or a different search term.',
    loadMore: 'Load more',
    endOfResults: 'That is everything matching.',
    sort: 'Sort',
  },

  vehicle: {
    specifications: 'Specifications',
    features: 'Features',
    description: 'Description',
    seller: 'Seller',
    mileage: 'Mileage',
    transmission: 'Transmission',
    drivetrain: 'Drivetrain',
    fuel: 'Fuel',
    bodyType: 'Body',
    condition: 'Condition',
    exterior: 'Exterior',
    vin: 'VIN',
    inspectionReport: 'Inspection report',
    frameDamage: 'Frame damage',
    accidentHistory: 'Accident history',
    notReported: 'Not reported',
    yes: 'Yes',
    no: 'No',
    save: 'Save this vehicle',
    unsave: 'Remove from saved',
    contactSeller: 'Message the seller',
    verifiedDealer: 'Verified dealer',
  },

  auction: {
    live: 'Live',
    liveAuction: 'Live auction',
    upcoming: 'Upcoming',
    ended: 'Ended',
    currentBid: 'Current bid',
    endsIn: 'Ends in',
    bids: 'bids',
    bid: 'bid',
    placeBid: 'Place a bid',
    minimumNextBid: 'Minimum next bid is',
    reserveMet: 'Reserve met',
    reserveNotMet: 'Reserve not met',
    noReserve: 'No reserve',
    youAreWinning: 'You are winning',
    outbid: 'You have been outbid',
    bidHistory: 'Bid history',
    noBidsYet: 'No bids yet',
    conflict:
      'Another bid landed at the same moment. The price above is current — bid again if you still want it.',
    signInToBid: 'Sign in to bid',
  },

  states: {
    loading: 'Loading',
    retry: 'Try again',
    notFound: 'Not found',
    notFoundHelp: 'This may have been removed or sold.',
    notAllowed: 'Not allowed',
    sessionEnded: 'Please sign in again',
    sessionEndedHelp: 'Your session has ended.',
    serverError: 'Atlas is having trouble',
    serverErrorHelp: 'The server could not complete that request.',
    offline: 'No connection',
    offlineHelp: 'Check your signal and try again.',
    somethingChanged: 'Something changed',
    tooMany: 'Too many requests',
    tooManyHelp: 'Wait a moment and try again.',
  },

  footer: {
    marketplace: 'Marketplace',
    sell: 'Sell',
    platform: 'Platform',
    browseVehicles: 'Browse vehicles',
    liveAuctions: 'Live auctions',
    buyNow: 'Buy now',
    inspectedVehicles: 'Inspected vehicles',
    sellYourVehicle: 'Sell your vehicle',
    dealerRegistration: 'Dealer registration',
    dealerPortal: 'Dealer portal',
    myAccount: 'My account',
    myBids: 'My bids',
    purchases: 'Purchases',
    demonstration: 'Demonstration platform.',
    currency: 'Prices in Canadian dollars.',
  },

  language: {
    label: 'Language',
    change: 'Change language',
  },

  theme: {
    toDark: 'Switch to dark mode',
    toLight: 'Switch to light mode',
  },
} as const;

/** The shape every locale must fill. */
export type Dictionary = {
  readonly [Section in keyof typeof en]: {
    readonly [Key in keyof (typeof en)[Section]]: string;
  };
};

const fr: Dictionary = {
  brand: {
    descriptor: 'Le marché automobile du Canada',
    tagline:
      'Un marché automobile canadien qui met en relation les acheteurs, les concessionnaires et les vendeurs particuliers, avec des enchères en direct et des rapports d’inspection indépendants.',
  },

  home: {
    heroTitle: 'Trouvez votre prochain véhicule, sans pression',
    heroBody:
      'Parcourez l’inventaire des concessionnaires et les annonces de particuliers partout au Canada, enchérissez en direct et achetez avec un rapport d’inspection indépendant en main.',
    quickSuvs: 'VUS',
    quickTrucks: 'Camions',
    quickElectric: 'Électrique',
    quickUnder: 'Moins de 30 000 $',
    quickInspected: 'Inspectés',
    shopByType: 'Parcourir par carrosserie',
    popularMakes: 'Marques populaires',
    closingSoon: 'Se terminent bientôt',
    closingSoonBody: 'Enchères en direct acceptant des offres maintenant.',
    recentlyListed: 'Ajoutés récemment',
    available: 'véhicules disponibles',
    freshInventory: 'Nouvel inventaire',
    browseAll: 'Tout parcourir',
    inventoryLoading:
      'L’inventaire se charge. Si cela persiste, l’API n’est peut-être pas démarrée.',
    inspectionsTitle: 'Inspections indépendantes',
    inspectionsBody:
      'Des rapports d’état évalués section par section, avec les dommages structurels divulgués d’emblée.',
    auctionsTitle: 'Enchères transparentes',
    auctionsBody:
      'Enchères en direct avec prolongation anti-sniping : un lot ne peut pas être remporté dans les dernières secondes.',
    sellersTitle: 'Concessionnaires et particuliers',
    sellersBody:
      'L’inventaire de concessionnaires vérifiés aux côtés des annonces de particuliers, dans un seul marché consultable.',
    sellingTitle: 'Vous vendez un véhicule ?',
    sellingBody:
      'Affichez-le à prix fixe ou passez-le aux enchères. Les concessionnaires obtiennent des outils d’inventaire, des analyses et la gestion des demandes ; les particuliers, un parcours d’annonce guidé.',
    sellCta: 'Vendre votre véhicule',
    dealerCta: 'S’inscrire comme concessionnaire',
    priceRange: 'L’inventaire actuel va de',
    priceRangeTo: 'à',
  },

  nav: {
    browse: 'Parcourir',
    auctions: 'Enchères',
    dashboard: 'Tableau de bord',
    inventory: 'Inventaire',
    admin: 'Administration',
    saved: 'Favoris',
    messages: 'Messages',
    notifications: 'Notifications',
    menu: 'Menu',
    close: 'Fermer',
  },

  auth: {
    signIn: 'Se connecter',
    signOut: 'Se déconnecter',
    createAccount: 'Créer un compte',
    email: 'Courriel',
    password: 'Mot de passe',
    firstName: 'Prénom',
    lastName: 'Nom',
    signInTitle: 'Connexion',
    signInSubtitle:
      'Bon retour. Connectez-vous pour enchérir, enregistrer des véhicules et écrire aux vendeurs.',
    registerTitle: 'Créer votre compte',
    registerSubtitle: 'Un seul compte pour acheter, vendre et enchérir.',
    noAccount: 'Nouveau sur Atlas ?',
    haveAccount: 'Vous avez déjà un compte ?',
    invalidCredentials: 'Ce courriel et ce mot de passe ne correspondent à aucun compte.',
    passwordHint:
      'Au moins 10 caractères, avec majuscules et minuscules, un chiffre et un symbole.',
    iWantTo: 'Je souhaite',
    dealershipName: 'Nom du concessionnaire',
    businessNumber: 'Numéro d’entreprise (facultatif)',
    province: 'Province (facultatif)',
    city: 'Ville (facultatif)',
  },

  search: {
    placeholder: 'Marque, modèle ou mot-clé',
    heroLabel: 'Rechercher des véhicules par marque, modèle ou mot-clé',
    heroPlaceholder: 'Essayez « RAV4 », « électrique AWD » ou « F-150 »',
    browseLabel: 'Rechercher des véhicules',
    browsePlaceholder: 'Rechercher par marque, modèle, couleur ou mot-clé',
    searching: 'Recherche en cours…',
    forQuery: 'pour',
    clearAll: 'Effacer tous les filtres',
    noMatchTitle: 'Aucun véhicule ne correspond à ces filtres',
    noMatchHelp: 'Élargissez la fourchette de prix ou d’années, ou retirez un filtre.',
    submit: 'Rechercher',
    anyMake: 'Toutes les marques',
    anyProvince: 'Partout au Canada',
    anyPrice: 'Tous les prix',
    makeLabel: 'Marque',
    modelLabel: 'Modèle',
    modelPlaceholder: 'p. ex. RAV4',
    maxPriceLabel: 'Prix maximum',
    provinceLabel: 'Province',
    advanced: 'Tous les filtres',
    filters: 'Filtres',
    clearFilters: 'Effacer les filtres',
    resultsOne: 'véhicule',
    resultsOther: 'véhicules',
    noResults: 'Aucun résultat',
    noResultsHelp: 'Essayez moins de filtres ou un autre terme de recherche.',
    loadMore: 'Afficher plus',
    endOfResults: 'Voilà tous les résultats correspondants.',
    sort: 'Trier',
  },

  vehicle: {
    specifications: 'Caractéristiques',
    features: 'Équipements',
    description: 'Description',
    seller: 'Vendeur',
    mileage: 'Kilométrage',
    transmission: 'Transmission',
    drivetrain: 'Rouage d’entraînement',
    fuel: 'Carburant',
    bodyType: 'Carrosserie',
    condition: 'État',
    exterior: 'Extérieur',
    vin: 'NIV',
    inspectionReport: 'Rapport d’inspection',
    frameDamage: 'Dommage au châssis',
    accidentHistory: 'Antécédents d’accident',
    notReported: 'Non déclaré',
    yes: 'Oui',
    no: 'Non',
    save: 'Enregistrer ce véhicule',
    unsave: 'Retirer des favoris',
    contactSeller: 'Écrire au vendeur',
    verifiedDealer: 'Concessionnaire vérifié',
  },

  auction: {
    live: 'En direct',
    liveAuction: 'Enchère en direct',
    upcoming: 'À venir',
    ended: 'Terminée',
    currentBid: 'Enchère actuelle',
    endsIn: 'Se termine dans',
    bids: 'enchères',
    bid: 'enchère',
    placeBid: 'Placer une enchère',
    minimumNextBid: 'La prochaine enchère minimale est de',
    reserveMet: 'Prix de réserve atteint',
    reserveNotMet: 'Prix de réserve non atteint',
    noReserve: 'Sans prix de réserve',
    youAreWinning: 'Vous êtes en tête',
    outbid: 'Vous avez été surenchéri',
    bidHistory: 'Historique des enchères',
    noBidsYet: 'Aucune enchère pour le moment',
    conflict:
      'Une autre enchère est arrivée au même moment. Le prix ci-dessus est à jour — enchérissez de nouveau si vous le souhaitez.',
    signInToBid: 'Connectez-vous pour enchérir',
  },

  states: {
    loading: 'Chargement',
    retry: 'Réessayer',
    notFound: 'Introuvable',
    notFoundHelp: 'Cet élément a peut-être été retiré ou vendu.',
    notAllowed: 'Non autorisé',
    sessionEnded: 'Veuillez vous reconnecter',
    sessionEndedHelp: 'Votre session a pris fin.',
    serverError: 'Atlas éprouve des difficultés',
    serverErrorHelp: 'Le serveur n’a pas pu traiter cette demande.',
    offline: 'Aucune connexion',
    offlineHelp: 'Vérifiez votre signal et réessayez.',
    somethingChanged: 'Quelque chose a changé',
    tooMany: 'Trop de requêtes',
    tooManyHelp: 'Patientez un instant et réessayez.',
  },

  footer: {
    marketplace: 'Marché',
    sell: 'Vendre',
    platform: 'Plateforme',
    browseVehicles: 'Parcourir les véhicules',
    liveAuctions: 'Enchères en direct',
    buyNow: 'Achat immédiat',
    inspectedVehicles: 'Véhicules inspectés',
    sellYourVehicle: 'Vendre votre véhicule',
    dealerRegistration: 'Inscription concessionnaire',
    dealerPortal: 'Portail concessionnaire',
    myAccount: 'Mon compte',
    myBids: 'Mes enchères',
    purchases: 'Achats',
    demonstration: 'Plateforme de démonstration.',
    currency: 'Prix en dollars canadiens.',
  },

  language: {
    label: 'Langue',
    change: 'Changer de langue',
  },

  theme: {
    toDark: 'Passer au mode sombre',
    toLight: 'Passer au mode clair',
  },
};

export const DICTIONARIES: Record<Locale, Dictionary> = { en, fr };

export const isLocale = (value: string | null | undefined): value is Locale =>
  value === 'en' || value === 'fr';
