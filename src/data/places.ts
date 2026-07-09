/**
 * Curated destinations reachable by public transport.
 *
 * Coordinates are the venue itself; /api/places verifies each one against the
 * live stops table (nearby_stops RPC) and only returns places that really have
 * a rail/KTM/bus stop within walking distance — the honesty filter. A place
 * with no stop nearby silently drops out instead of lying.
 */

export type PlaceCategory = 'mall' | 'hospital' | 'attraction'

export interface Place {
  id: string
  name: string
  category: PlaceCategory
  city: string
  lat: number
  lon: number
}

export const PLACES: Place[] = [
  // ── Malls — Klang Valley ─────────────────────────────────────────────────
  { id: 'suria-klcc',        name: 'Suria KLCC',              category: 'mall', city: 'Kuala Lumpur',  lat: 3.1578,  lon: 101.7123 },
  { id: 'pavilion-kl',       name: 'Pavilion Kuala Lumpur',   category: 'mall', city: 'Bukit Bintang', lat: 3.1489,  lon: 101.7133 },
  { id: 'lot-10',            name: 'Lot 10',                  category: 'mall', city: 'Bukit Bintang', lat: 3.1468,  lon: 101.7109 },
  { id: 'sungei-wang',       name: 'Sungei Wang Plaza',       category: 'mall', city: 'Bukit Bintang', lat: 3.1463,  lon: 101.7106 },
  { id: 'berjaya-times-sq',  name: 'Berjaya Times Square',    category: 'mall', city: 'Kuala Lumpur',  lat: 3.1421,  lon: 101.7103 },
  { id: 'lalaport',          name: 'LaLaport BBCC',           category: 'mall', city: 'Kuala Lumpur',  lat: 3.1400,  lon: 101.7079 },
  { id: 'mid-valley',        name: 'Mid Valley Megamall',     category: 'mall', city: 'Kuala Lumpur',  lat: 3.1177,  lon: 101.6774 },
  { id: 'the-gardens',       name: 'The Gardens Mall',        category: 'mall', city: 'Kuala Lumpur',  lat: 3.1186,  lon: 101.6758 },
  { id: 'nu-sentral',        name: 'NU Sentral',              category: 'mall', city: 'KL Sentral',    lat: 3.1336,  lon: 101.6864 },
  { id: 'sogo-kl',           name: 'SOGO Kuala Lumpur',       category: 'mall', city: 'Kuala Lumpur',  lat: 3.1550,  lon: 101.6944 },
  { id: 'sunway-putra',      name: 'Sunway Putra Mall',       category: 'mall', city: 'Kuala Lumpur',  lat: 3.1663,  lon: 101.6935 },
  { id: 'mytown-kl',         name: 'MyTOWN Shopping Centre',  category: 'mall', city: 'Cheras',        lat: 3.1287,  lon: 101.7233 },
  { id: 'sunway-velocity',   name: 'Sunway Velocity Mall',    category: 'mall', city: 'Cheras',        lat: 3.1279,  lon: 101.7183 },
  { id: 'ikea-cheras',       name: 'IKEA Cheras',             category: 'mall', city: 'Cheras',        lat: 3.1294,  lon: 101.7245 },
  { id: 'trx-exchange',      name: 'The Exchange TRX',        category: 'mall', city: 'Kuala Lumpur',  lat: 3.1421,  lon: 101.7181 },
  { id: 'kwc-fashion',       name: 'KWC Fashion Mall',        category: 'mall', city: 'Pudu',          lat: 3.1345,  lon: 101.7133 },
  { id: 'one-utama',         name: '1 Utama Shopping Centre', category: 'mall', city: 'Petaling Jaya', lat: 3.1502,  lon: 101.6154 },
  { id: 'the-curve',         name: 'The Curve & IPC',         category: 'mall', city: 'Mutiara Damansara', lat: 3.1571, lon: 101.6115 },
  { id: 'amcorp-mall',       name: 'Amcorp Mall',             category: 'mall', city: 'Petaling Jaya', lat: 3.1043,  lon: 101.6432 },
  { id: 'paradigm-pj',       name: 'Paradigm Mall PJ',        category: 'mall', city: 'Petaling Jaya', lat: 3.1050,  lon: 101.5946 },
  { id: 'sunway-pyramid',    name: 'Sunway Pyramid',          category: 'mall', city: 'Subang Jaya',   lat: 3.0733,  lon: 101.6078 },
  { id: 'subang-parade',     name: 'Subang Parade',           category: 'mall', city: 'Subang Jaya',   lat: 3.0821,  lon: 101.5867 },
  { id: 'wangsa-walk',       name: 'Wangsa Walk Mall',        category: 'mall', city: 'Wangsa Maju',   lat: 3.2043,  lon: 101.7365 },
  { id: 'aeon-metro-prima',  name: 'AEON Metro Prima',        category: 'mall', city: 'Kepong',        lat: 3.2153,  lon: 101.6382 },
  { id: 'setapak-central',   name: 'Setapak Central',         category: 'mall', city: 'Setapak',       lat: 3.2017,  lon: 101.7181 },
  { id: 'ioi-puchong',       name: 'IOI Mall Puchong',        category: 'mall', city: 'Puchong',       lat: 3.0466,  lon: 101.6193 },
  { id: 'evolve-concept',    name: 'Evolve Concept Mall',     category: 'mall', city: 'Ara Damansara', lat: 3.1123,  lon: 101.5768 },
  { id: 'klang-parade',      name: 'Klang Parade',            category: 'mall', city: 'Klang',         lat: 3.0428,  lon: 101.4557 },

  // ── Malls — outside Klang Valley (KTM-reachable) ─────────────────────────
  { id: 'penang-sentral',    name: 'Penang Sentral',          category: 'mall', city: 'Butterworth',   lat: 5.3980,  lon: 100.3639 },
  { id: 'jb-city-square',    name: 'Johor Bahru City Square', category: 'mall', city: 'Johor Bahru',   lat: 1.4622,  lon: 103.7649 },
  { id: 'seremban-prima',    name: 'Seremban Prima Mall',     category: 'mall', city: 'Seremban',      lat: 2.7195,  lon: 101.9400 },
  { id: 'ipoh-parade',       name: 'Ipoh Parade',             category: 'mall', city: 'Ipoh',          lat: 4.5920,  lon: 101.0901 },

  // ── Hospitals ────────────────────────────────────────────────────────────
  { id: 'hkl',               name: 'Hospital Kuala Lumpur',   category: 'hospital', city: 'Kuala Lumpur',  lat: 3.1723,  lon: 101.7022 },
  { id: 'ijn',               name: 'Institut Jantung Negara (IJN)', category: 'hospital', city: 'Kuala Lumpur', lat: 3.1734, lon: 101.7050 },
  { id: 'ummc',              name: 'Pusat Perubatan Universiti Malaya (PPUM)', category: 'hospital', city: 'Petaling Jaya', lat: 3.1122, lon: 101.6541 },
  { id: 'hukm',              name: 'Hospital Canselor Tuanku Muhriz (HCTM/HUKM)', category: 'hospital', city: 'Cheras', lat: 3.0913, lon: 101.7248 },
  { id: 'gleneagles-kl',     name: 'Gleneagles Hospital KL',  category: 'hospital', city: 'Ampang',       lat: 3.1608,  lon: 101.7311 },
  { id: 'prince-court',      name: 'Prince Court Medical Centre', category: 'hospital', city: 'Kuala Lumpur', lat: 3.1441, lon: 101.7222 },
  { id: 'tung-shin',         name: 'Tung Shin Hospital',      category: 'hospital', city: 'Pudu',          lat: 3.1445,  lon: 101.7043 },
  { id: 'kpj-tawakkal',      name: 'KPJ Tawakkal Specialist', category: 'hospital', city: 'Titiwangsa',    lat: 3.1710,  lon: 101.6982 },
  { id: 'sunway-medical',    name: 'Sunway Medical Centre',   category: 'hospital', city: 'Subang Jaya',   lat: 3.0693,  lon: 101.6091 },
  { id: 'thomson-kd',        name: 'Thomson Hospital Kota Damansara', category: 'hospital', city: 'Kota Damansara', lat: 3.1521, lon: 101.5934 },
  { id: 'hosp-kajang',       name: 'Hospital Kajang',         category: 'hospital', city: 'Kajang',        lat: 2.9917,  lon: 101.7873 },
  { id: 'hosp-klang',        name: 'Hospital Tengku Ampuan Rahimah', category: 'hospital', city: 'Klang',  lat: 3.0225,  lon: 101.4413 },
  { id: 'hosp-seremban',     name: 'Hospital Tuanku Ja\'afar', category: 'hospital', city: 'Seremban',     lat: 2.7127,  lon: 101.9450 },
  { id: 'hosp-ipoh',         name: 'Hospital Raja Permaisuri Bainun', category: 'hospital', city: 'Ipoh',  lat: 4.6015,  lon: 101.0910 },
  { id: 'hosp-selayang',     name: 'Hospital Selayang',       category: 'hospital', city: 'Selayang',      lat: 3.2431,  lon: 101.6543 },
  { id: 'hosp-shah-alam',    name: 'Hospital Shah Alam',      category: 'hospital', city: 'Shah Alam',     lat: 3.0700,  lon: 101.4930 },

  // ── Attractions ──────────────────────────────────────────────────────────
  { id: 'klcc-park',         name: 'Menara Berkembar Petronas & KLCC Park', category: 'attraction', city: 'Kuala Lumpur', lat: 3.1579, lon: 101.7116 },
  { id: 'aquaria-klcc',      name: 'Aquaria KLCC',            category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1539,  lon: 101.7133 },
  { id: 'kl-tower',          name: 'Menara Kuala Lumpur (KL Tower)', category: 'attraction', city: 'Kuala Lumpur', lat: 3.1528, lon: 101.7038 },
  { id: 'merdeka-118',       name: 'Merdeka 118',             category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1417,  lon: 101.7009 },
  { id: 'dataran-merdeka',   name: 'Dataran Merdeka',         category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1479,  lon: 101.6935 },
  { id: 'central-market',    name: 'Central Market (Pasar Seni)', category: 'attraction', city: 'Kuala Lumpur', lat: 3.1457, lon: 101.6953 },
  { id: 'petaling-street',   name: 'Petaling Street (Chinatown)', category: 'attraction', city: 'Kuala Lumpur', lat: 3.1440, lon: 101.6980 },
  { id: 'kwai-chai-hong',    name: 'Kwai Chai Hong',          category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1425,  lon: 101.6982 },
  { id: 'masjid-jamek',      name: 'Masjid Jamek Sultan Abdul Samad', category: 'attraction', city: 'Kuala Lumpur', lat: 3.1489, lon: 101.6957 },
  { id: 'muzium-negara',     name: 'Muzium Negara',           category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1373,  lon: 101.6871 },
  { id: 'masjid-negara',     name: 'Masjid Negara & Taman Botani Perdana', category: 'attraction', city: 'Kuala Lumpur', lat: 3.1418, lon: 101.6917 },
  { id: 'islamic-arts',      name: 'Muzium Kesenian Islam',   category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1421,  lon: 101.6896 },
  { id: 'batu-caves',        name: 'Batu Caves',              category: 'attraction', city: 'Gombak',        lat: 3.2379,  lon: 101.6840 },
  { id: 'titiwangsa-park',   name: 'Taman Tasik Titiwangsa', category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1785,  lon: 101.7050 },
  { id: 'kampung-baru',      name: 'Kampung Baru (makan!)',   category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1622,  lon: 101.7069 },
  { id: 'saloma-bridge',     name: 'Pintasan Saloma',         category: 'attraction', city: 'Kuala Lumpur',  lat: 3.1607,  lon: 101.7076 },
  { id: 'brickfields',       name: 'Little India Brickfields', category: 'attraction', city: 'KL Sentral',   lat: 3.1290,  lon: 101.6841 },
  { id: 'sunway-lagoon',     name: 'Sunway Lagoon',           category: 'attraction', city: 'Subang Jaya',   lat: 3.0716,  lon: 101.6069 },
  { id: 'ipoh-old-town',     name: 'Ipoh Old Town',           category: 'attraction', city: 'Ipoh',          lat: 4.5975,  lon: 101.0790 },
  { id: 'taiping-lake',      name: 'Taiping Lake Gardens',    category: 'attraction', city: 'Taiping',       lat: 4.8541,  lon: 100.7480 },
  { id: 'georgetown-ferry',  name: 'George Town (feri dari Butterworth)', category: 'attraction', city: 'Pulau Pinang', lat: 5.3990, lon: 100.3645 },
  { id: 'jb-bazaar',         name: 'Bazar JB & Tebrau Waterfront', category: 'attraction', city: 'Johor Bahru', lat: 1.4615, lon: 103.7642 },
]
