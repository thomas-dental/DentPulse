// Registry of nearby dental clinic FEE PAGES. The LLM scrapes each
// URL live (via Anthropic's web_fetch / web_search tools) at suggestion
// time, so prices stay current without manual transcription. This file
// no longer stores prices — only the metadata needed to find and open
// the right page:
//   * clinic_name      — exact name as the user/Google sees it
//   * city / postcode  — used to filter to clinics near the user
//   * source_url       — the LIVE fee/price-list page; passed to the
//                        model with instructions to extract the line
//                        item that matches the user's treatment
//   * rating / reviews — optional; surfaces a ★ badge in the panel
//
// To add a clinic: append an entry with a URL that lists their published
// fees. No price transcription needed — the LLM reads the live page.

export interface KnownClinic {
  clinic_name: string;
  city: string;
  postcode_outward: string;
  source_url: string;
  rating?: number;
  review_count?: number;
}

export const KNOWN_CLINIC_PRICES: KnownClinic[] = [
  {
    clinic_name: 'Trinity Dental Practice',
    city: 'Elgin',
    postcode_outward: 'IV30',
    source_url: 'https://trinitydentist.co.uk/fees/',
    rating: 4.4,
    review_count: 17,
  },
  {
    clinic_name: 'Bupa Dental Care Elgin',
    city: 'Elgin',
    postcode_outward: 'IV30',
    source_url:
      'https://www.bupa.co.uk/dental/dental-care/practices/elgin/treatment-prices',
    rating: 4.8,
    review_count: 42,
  },
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\(\)\[\]{}]/g, ' ')
    .replace(/[-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Return the registered fee pages closest to the user, capped at limit.
 * Postcode-outward beats city beats nothing. Excluded clinics (the user's
 * own org/location) are dropped so the panel never shows their own
 * published fee back at them.
 *
 * The caller passes this list to the AI prompt with instructions to open
 * each URL and extract the line item matching the requested treatment.
 */
export function findNearbyKnownClinics(args: {
  city?: string | null;
  postcodeOutward?: string | null;
  excludeClinicNames?: string[];
  limit?: number;
}): KnownClinic[] {
  const {
    city,
    postcodeOutward,
    excludeClinicNames = [],
    limit = 3,
  } = args;

  const normCity = city ? norm(city) : '';
  const normOutward = postcodeOutward ? norm(postcodeOutward) : '';
  const excluded = new Set(excludeClinicNames.map((n) => norm(n)));

  const ranked = KNOWN_CLINIC_PRICES.filter(
    (c) => !excluded.has(norm(c.clinic_name)),
  )
    .map((c) => {
      let proximity = 0;
      if (normOutward && norm(c.postcode_outward) === normOutward) proximity = 2;
      else if (normCity && norm(c.city) === normCity) proximity = 1;
      return { clinic: c, proximity };
    })
    .sort((a, b) => b.proximity - a.proximity);

  return ranked.slice(0, limit).map((r) => r.clinic);
}
