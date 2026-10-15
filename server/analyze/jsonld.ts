import type { PageFacts } from '../../shared/types.ts';

export type Node = Record<string, unknown> & { '@type'?: string | string[]; '@id'?: string };

export const ORG_TYPES = new Set([
  'Organization', 'Corporation', 'LocalBusiness', 'NGO', 'GovernmentOrganization', 'EducationalOrganization',
  'MedicalOrganization', 'MedicalClinic', 'MedicalBusiness', 'Hospital', 'Dentist', 'Physician', 'ProfessionalService',
  'RealEstateAgent', 'Store', 'OnlineStore', 'OnlineBusiness', 'Restaurant', 'FoodEstablishment', 'LodgingBusiness',
  'Hotel', 'SportsOrganization', 'NewsMediaOrganization', 'HomeAndConstructionBusiness', 'GeneralContractor',
  'LegalService', 'FinancialService', 'AutomotiveBusiness', 'HealthAndBeautyBusiness', 'TravelAgency', 'CollegeOrUniversity',
  'School', 'PerformingGroup', 'Airline', 'Consortium', 'FundingScheme', 'ResearchOrganization', 'WorkersUnion',
]);

export const PAGE_TYPES = new Set([
  'WebPage', 'AboutPage', 'ContactPage', 'ItemPage', 'CollectionPage', 'FAQPage', 'ProfilePage', 'QAPage',
  'SearchResultsPage', 'CheckoutPage', 'MedicalWebPage', 'RealEstateListing',
]);

export const STRUCTURAL_TYPES = new Set([
  'WebSite', 'BreadcrumbList', 'ListItem', 'ImageObject', 'SearchAction', 'EntryPoint', 'PropertyValueSpecification',
  'ReadAction', 'SiteNavigationElement', 'WPHeader', 'WPFooter', 'WPSideBar', 'Person', 'PostalAddress', 'GeoCoordinates',
  'ContactPoint', 'Offer', 'AggregateOffer', 'Question', 'Answer', 'Rating', 'AggregateRating', 'VideoObject',
  'OpeningHoursSpecification', 'PriceSpecification', 'UnitPriceSpecification', 'QuantitativeValue', 'Place',
  'Country', 'City', 'Language',
]);

/** Fő entitás típusa (szabad szöveg) → szóba jövő schema.org típusok. */
const ENTITY_MAP: [RegExp, string[]][] = [
  [/ingatlan|lakás|lakópark|társasház|residence|apartment|house|ház/i, ['Residence', 'ApartmentComplex', 'Apartment', 'Accommodation', 'House', 'SingleFamilyResidence', 'GatedResidenceCommunity', 'RealEstateListing', 'Place']],
  [/termék|product|webshop|áru/i, ['Product', 'ProductGroup', 'ProductModel', 'IndividualProduct', 'Vehicle', 'Car']],
  [/esemény|event|rendezvény|konferencia|koncert|fesztivál|előadás|workshop/i, ['Event', 'BusinessEvent', 'EducationEvent', 'MusicEvent', 'Festival', 'ExhibitionEvent', 'SocialEvent', 'SportsEvent', 'TheaterEvent']],
  [/képzés|kurzus|tanfolyam|course|oktatás/i, ['Course', 'CourseInstance', 'EducationEvent', 'EducationalOccupationalProgram']],
  [/orvos|klinika|rendelő|kezelés|egészség|medical|fogász/i, ['MedicalProcedure', 'MedicalTherapy', 'MedicalClinic', 'Physician', 'MedicalBusiness', 'Service', 'Dentist', 'MedicalWebPage']],
  [/szálláshely|szálloda|hotel|panzió|apartman/i, ['LodgingBusiness', 'Hotel', 'Accommodation', 'HotelRoom', 'VacationRental', 'Place']],
  [/étterem|restaurant|kávézó/i, ['Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Menu']],
  [/szolgáltatás|service/i, ['Service', 'ProfessionalService', 'LocalBusiness', 'FinancialProduct', 'Offer']],
  [/szervezet|cég|vállalat|organization|company|egyesület|alapítvány/i, [...ORG_TYPES]],
  [/projekt|program|pályázat/i, ['Project', 'ResearchProject', 'FundingScheme', 'Event', 'CreativeWork']],
  [/hely|helyszín|place|látványosság/i, ['Place', 'TouristAttraction', 'LandmarksOrHistoricalBuildings', 'CivicStructure']],
  [/cikk|blog|hír|article/i, ['Article', 'BlogPosting', 'NewsArticle']],
];

export function candidateTypes(entityType: string): string[] | undefined {
  for (const [re, types] of ENTITY_MAP) if (re.test(entityType)) return types;
  return undefined;
}

export function typesOf(n: Node): string[] {
  const t = n['@type'];
  return typeof t === 'string' ? [t] : Array.isArray(t) ? t.filter((x): x is string => typeof x === 'string') : [];
}

/** Minden objektum a JSON-LD-ből laposítva (@graph és beágyazott node-ok). */
export function flattenNodes(facts: PageFacts | undefined): Node[] {
  const out: Node[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      const o = v as Node;
      if (o['@type']) out.push(o);
      for (const [k, val] of Object.entries(o)) if (k !== '@context' && val && typeof val === 'object') walk(val);
    }
  };
  for (const b of facts?.jsonld ?? []) if (b.parsed) walk(b.parsed);
  return out;
}

export function nameOf(n: Node): string | undefined {
  const v = n['name'];
  return typeof v === 'string' ? v : undefined;
}

/** Minden @id-hivatkozás egy node-ban (pl. {"@id": "..."} értékek). */
export function refsIn(n: Node): string[] {
  const out: string[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      const o = v as Node;
      if (typeof o['@id'] === 'string' && depth > 0) out.push(o['@id']);
      for (const [k, val] of Object.entries(o)) if (k !== '@id') walk(val, depth + 1);
    }
  };
  walk(n, 0);
  return out;
}
