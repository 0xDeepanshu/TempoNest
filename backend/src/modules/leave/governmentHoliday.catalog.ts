import type { GovernmentHolidayCategory } from './leaveHoliday.model';

/**
 * Curated government holiday catalog.
 *
 * There is no reliable machine-readable government holiday API, so this file
 * only contains dates transcribed from official government documents. Entries
 * must never be added from memory, aggregator sites, or projections: add a new
 * year or jurisdiction only after verifying the signed gazette/office
 * memorandum and recording its reference, URL, and retrieval date below.
 */

export interface GovernmentHolidayEntry {
  /** Stable catalog identifier used to prevent duplicate imports. */
  sourceId: string;
  name: string;
  holidayDate: string;
  category: GovernmentHolidayCategory;
  notes?: string;
}

export interface GovernmentHolidaySource {
  name: string;
  issuer: string;
  reference: string;
  url: string;
  retrievedOn: string;
  verification: string;
}

export interface GovernmentHolidayYear {
  year: number;
  source: GovernmentHolidaySource;
  entries: GovernmentHolidayEntry[];
}

export interface GovernmentJurisdiction {
  country: string;
  countryName: string;
  region: string;
  regionName: string;
  years: GovernmentHolidayYear[];
}

export const GOVERNMENT_COUNTRIES = [{ code: 'IN', name: 'India' }] as const;

export const GOVERNMENT_REGIONS: Record<
  string,
  Array<{ code: string; name: string }>
> = {
  IN: [
    { code: 'NATIONAL', name: 'India — Central Government (national)' },
    { code: 'UTTARAKHAND', name: 'Uttarakhand' },
  ],
};

const NATIONAL_SOURCE_2026: GovernmentHolidaySource = {
  name: 'Central Government holidays for the year 2026',
  issuer:
    'Ministry of Personnel, Public Grievances and Pensions (Department of Personnel and Training)',
  reference:
    'O.M. No. 12/2/2023-JCA dated 3 July 2025 — Annexure I (gazetted) and Annexure II (restricted)',
  url: 'https://documents.doptcirculars.nic.in/D2/D02est/Holidays%20to%20be%20observed%20in%20Central%20Government%20Offices%20during%20the%20year%2020265vgBs.pdf',
  retrievedOn: '2026-10-30',
  verification:
    'Dates and weekdays transcribed from the scanned O.M. annexures. Muharram is 26 June 2026 (Friday), matching the printed weekday; a secondary web page that listed 26 July was incorrect.',
};

const UTTARAKHAND_SOURCE_2026: GovernmentHolidaySource = {
  name: 'Uttarakhand public holidays order for the year 2026',
  issuer: 'General Administration Department, Government of Uttarakhand',
  reference:
    'GAD-GEN/GEN/28/2025-XXXI-A-1, No. 1800/XXXI(15)G/25-74/2016, Dehradun, dated 24 December 2025 — Annexures 1, 2 and 3',
  url: 'https://spiderimg.amarujala.com/assets/applications/2025/12/24/holidays-list-2026_694beebe1007a.pdf',
  retrievedOn: '2026-10-30',
  verification:
    'Gazetted, additional and restricted holiday tables transcribed from the signed state order. Annexure 4 (bank holidays under the Negotiable Instruments Act) is excluded because it does not apply to office attendance. English names are display translations of the official Hindi names.',
};

type EntryTuple = readonly [
  name: string,
  holidayDate: string,
  category: GovernmentHolidayCategory,
  notes?: string,
];

function withIds(prefix: string, tuples: EntryTuple[]): GovernmentHolidayEntry[] {
  return tuples.map(([name, holidayDate, category, notes], index) => ({
    sourceId: `${prefix}-${String(index + 1).padStart(2, '0')}`,
    name,
    holidayDate,
    category,
    ...(notes ? { notes } : {}),
  }));
}

/** DoPT Annexure I — 17 compulsory/gazetted holidays for Central Government offices. */
const NATIONAL_GAZETTED_2026 = withIds('in-national-2026-gaz', [
  ['Republic Day', '2026-01-26', 'NATIONAL'],
  ['Holi', '2026-03-04', 'GAZETTED'],
  ['Id-ul-Fitr', '2026-03-21', 'GAZETTED', 'Subject to moon sighting.'],
  ['Ram Navami', '2026-03-26', 'GAZETTED'],
  ['Mahavir Jayanti', '2026-03-31', 'GAZETTED'],
  ['Good Friday', '2026-04-03', 'GAZETTED'],
  ['Buddha Purnima', '2026-05-01', 'GAZETTED'],
  ['Id-ul-Zuha (Bakrid)', '2026-05-27', 'GAZETTED', 'Subject to moon sighting.'],
  ['Muharram', '2026-06-26', 'GAZETTED', 'Subject to moon sighting.'],
  ['Independence Day', '2026-08-15', 'NATIONAL'],
  [
    'Milad-un-Nabi (Birthday of Prophet Mohammad)',
    '2026-08-26',
    'GAZETTED',
    'Subject to moon sighting.',
  ],
  ['Janmashtami', '2026-09-04', 'GAZETTED'],
  ["Mahatma Gandhi's Birthday", '2026-10-02', 'NATIONAL'],
  ['Dussehra', '2026-10-20', 'GAZETTED'],
  ['Diwali (Deepavali)', '2026-11-08', 'GAZETTED'],
  ["Guru Nanak's Birthday", '2026-11-24', 'GAZETTED'],
  ['Christmas Day', '2026-12-25', 'GAZETTED'],
]);

/** DoPT Annexure II — 34 restricted (optional) holidays for Delhi/New Delhi. */
const NATIONAL_RESTRICTED_2026 = withIds('in-national-2026-rh', [
  ["New Year's Day", '2026-01-01', 'RESTRICTED'],
  ["Hazarat Ali's Birthday", '2026-01-03', 'RESTRICTED'],
  ['Makar Sankranti', '2026-01-14', 'RESTRICTED'],
  ['Magha Bihu / Pongal', '2026-01-14', 'RESTRICTED'],
  ['Sri Panchami, Basant Panchami', '2026-01-23', 'RESTRICTED'],
  ["Guru Ravi Das's Birthday", '2026-02-01', 'RESTRICTED'],
  ['Birthday of Swami Dayananda Saraswati', '2026-02-12', 'RESTRICTED'],
  ['Maha Shivratri', '2026-02-15', 'RESTRICTED'],
  ['Shiva ji Jayanti', '2026-02-19', 'RESTRICTED'],
  ['Holika Dahan', '2026-03-03', 'RESTRICTED'],
  ['Dolyatra', '2026-03-03', 'RESTRICTED'],
  [
    'Chaitra Sukladi / Gudi Padava / Ugadi / Cheti Chand',
    '2026-03-19',
    'RESTRICTED',
  ],
  ['Jamat-Ul-Vida', '2026-03-20', 'RESTRICTED'],
  ['Easter Sunday', '2026-04-05', 'RESTRICTED'],
  ["Vaisakhi / Vishu / Meshadi (Tamil New Year's Day)", '2026-04-14', 'RESTRICTED'],
  ['Vaisakhadi (Bengal) / Bahag Bihu (Assam)', '2026-04-15', 'RESTRICTED'],
  ['Birthday of Guru Rabindranath Tagore', '2026-05-09', 'RESTRICTED'],
  ['Rath Yatra', '2026-07-16', 'RESTRICTED'],
  ["Parsi New Year's Day / Nauraj", '2026-08-15', 'RESTRICTED'],
  ['Onam or Thiru Onam Day', '2026-08-26', 'RESTRICTED'],
  ['Raksha Bandhan', '2026-08-28', 'RESTRICTED'],
  ['Ganesh Chaturthi / Vinayak Chaturthi', '2026-09-14', 'RESTRICTED'],
  ['Dussehra (Saptami)', '2026-10-18', 'RESTRICTED'],
  ['Dussehra (Mahashtami)', '2026-10-19', 'RESTRICTED'],
  ['Dussehra (Mahanavmi)', '2026-10-20', 'RESTRICTED'],
  ["Maharishi Valmiki's Birthday", '2026-10-26', 'RESTRICTED'],
  ['Karaka Chaturthi (Karwa Chouth)', '2026-10-29', 'RESTRICTED'],
  ['Naraka Chaturdasi', '2026-11-08', 'RESTRICTED'],
  ['Govardhan Puja', '2026-11-09', 'RESTRICTED'],
  ['Bhai Duj', '2026-11-11', 'RESTRICTED'],
  ['Pratihar Shashthi or Surya Shashthi (Chhat Puja)', '2026-11-15', 'RESTRICTED'],
  ["Guru Teg Bahadur's Martyrdom Day", '2026-11-24', 'RESTRICTED'],
  ["Hazarat Ali's Birthday", '2026-12-23', 'RESTRICTED'],
  ['Christmas Eve', '2026-12-24', 'RESTRICTED'],
]);

/** Uttarakhand Annexure 1 — 25 public holidays declared across the state. */
const UTTARAKHAND_GAZETTED_2026 = withIds('in-uttarakhand-2026-gaz', [
  ['Republic Day', '2026-01-26', 'NATIONAL'],
  ['Maha Shivratri', '2026-02-15', 'STATE'],
  ['Holika Dahan', '2026-03-03', 'STATE'],
  ['Holi', '2026-03-04', 'STATE'],
  ['Id-ul-Fitr', '2026-03-21', 'STATE', 'Subject to moon sighting.'],
  ['Ram Navami', '2026-03-26', 'STATE'],
  ['Mahavir Jayanti', '2026-03-31', 'STATE'],
  ['Good Friday', '2026-04-03', 'STATE'],
  ['Dr. B.R. Ambedkar Jayanti', '2026-04-14', 'STATE'],
  ['Buddha Purnima', '2026-05-01', 'STATE'],
  ['Id-ul-Zuha (Bakrid)', '2026-05-27', 'STATE', 'Subject to moon sighting.'],
  ['Muharram', '2026-06-26', 'STATE', 'Subject to moon sighting.'],
  ['Harela', '2026-07-16', 'STATE'],
  ['Independence Day', '2026-08-15', 'NATIONAL'],
  ['Milad-un-Nabi (Barawafat)', '2026-08-26', 'STATE', 'Subject to moon sighting.'],
  ['Raksha Bandhan', '2026-08-28', 'STATE'],
  ['Janmashtami', '2026-09-04', 'STATE'],
  ['Mahatma Gandhi Jayanti', '2026-10-02', 'NATIONAL'],
  ['Dussehra (Vijay Dashami)', '2026-10-20', 'STATE'],
  ['Maharishi Valmiki Jayanti', '2026-10-26', 'STATE'],
  ['Diwali', '2026-11-08', 'STATE'],
  ['Diwali (Govardhan Puja)', '2026-11-10', 'STATE'],
  ['Igas-Bagwal', '2026-11-20', 'STATE'],
  ['Guru Nanak Jayanti', '2026-11-24', 'STATE'],
  ['Christmas Day', '2026-12-25', 'STATE'],
]);

/**
 * Uttarakhand Annexure 2 — three additional public holidays. For offices on a
 * five-day week these are treated as restricted holidays, so admins choose
 * whether to publish them.
 */
const UTTARAKHAND_ADDITIONAL_2026 = withIds('in-uttarakhand-2026-add', [
  ['Cheti Chand', '2026-03-19', 'STATE'],
  ['Vishwakarma Puja', '2026-09-17', 'STATE'],
  ['Guru Tegh Bahadur Martyrdom Day', '2026-11-24', 'STATE'],
]);

/** Uttarakhand Annexure 3 — 17 restricted holidays, of which an employee may take two. */
const UTTARAKHAND_RESTRICTED_2026 = withIds('in-uttarakhand-2026-rh', [
  ["New Year's Day", '2026-01-01', 'RESTRICTED'],
  ['Makar Sankranti', '2026-01-14', 'RESTRICTED'],
  ['Basant Panchami', '2026-01-23', 'RESTRICTED'],
  ['Guru Ravi Das Jayanti', '2026-02-01', 'RESTRICTED'],
  ['Shab-e-Barat', '2026-03-03', 'RESTRICTED', 'Subject to moon sighting.'],
  ['Jamat-ul-Vida', '2026-03-13', 'RESTRICTED'],
  ['Easter Monday', '2026-04-06', 'RESTRICTED'],
  ['Vaisakhi', '2026-04-14', 'RESTRICTED'],
  ['Veer Kesari Chand Martyrdom Day', '2026-05-03', 'RESTRICTED'],
  ['Chahallum', '2026-08-04', 'RESTRICTED', 'Subject to moon sighting.'],
  ['Anant Chaturdashi', '2026-09-25', 'RESTRICTED'],
  ['Maharaja Agrasen Jayanti', '2026-10-11', 'RESTRICTED'],
  ['Dussehra (Mahanavami)', '2026-10-20', 'RESTRICTED'],
  ['Diwali (Narak Chaturdashi)', '2026-11-07', 'RESTRICTED'],
  ['Bhaiya Dooj', '2026-11-11', 'RESTRICTED'],
  ['Chhath Puja', '2026-11-15', 'RESTRICTED'],
  ['Christmas Eve', '2026-12-24', 'RESTRICTED'],
]);

export const GOVERNMENT_JURISDICTIONS: GovernmentJurisdiction[] = [
  {
    country: 'IN',
    countryName: 'India',
    region: 'NATIONAL',
    regionName: 'India — Central Government (national)',
    years: [
      {
        year: 2026,
        source: NATIONAL_SOURCE_2026,
        entries: [...NATIONAL_GAZETTED_2026, ...NATIONAL_RESTRICTED_2026],
      },
    ],
  },
  {
    country: 'IN',
    countryName: 'India',
    region: 'UTTARAKHAND',
    regionName: 'Uttarakhand',
    years: [
      {
        year: 2026,
        source: UTTARAKHAND_SOURCE_2026,
        entries: [
          ...UTTARAKHAND_GAZETTED_2026,
          ...UTTARAKHAND_ADDITIONAL_2026,
          ...UTTARAKHAND_RESTRICTED_2026,
        ],
      },
    ],
  },
];

export function findGovernmentJurisdiction(
  country: string,
  region: string,
): GovernmentJurisdiction | undefined {
  return GOVERNMENT_JURISDICTIONS.find(
    (jurisdiction) => jurisdiction.country === country && jurisdiction.region === region,
  );
}

export function findGovernmentYear(
  country: string,
  region: string,
  year: number,
): GovernmentHolidayYear | undefined {
  return findGovernmentJurisdiction(country, region)?.years.find(
    (candidate) => candidate.year === year,
  );
}

export function availableGovernmentYears(country: string, region: string): number[] {
  return (findGovernmentJurisdiction(country, region)?.years ?? [])
    .map((entry) => entry.year)
    .sort((left, right) => left - right);
}
