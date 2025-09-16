export interface GeocodingResult {
  query: string;
  address: string;
  latitude: number;
  longitude: number;
}

const MIN_QUERY_LENGTH = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

interface Coordinates {
  latitude: number;
  longitude: number;
}

const normaliseQuery = (query: string): string =>
  query
    .trim()
    .replace(/\s+/gu, ' ')
    .replace(/,+/gu, ',')
    .replace(/\s*,\s*/gu, ', ');

const parseTimeout = (value: string | null | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const getFirstDefinedEnv = (...keys: string[]): string | null => {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }

  return null;
};

const decodeComponent = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const isValidCoordinate = (latitude: number, longitude: number): boolean =>
  Number.isFinite(latitude) &&
  Number.isFinite(longitude) &&
  Math.abs(latitude) <= 90 &&
  Math.abs(longitude) <= 180;

const parseCoordinatePair = (value: string): Coordinates | null => {
  const decoded = decodeComponent(value)
    .replace(/[^0-9,./\-\s]+/gu, ' ')
    .replace(/%2C/giu, ',')
    .replace(/%7C/giu, ' ')
    .trim();

  const match = /(-?\d+(?:\.\d+)?)[,\s/]+(-?\d+(?:\.\d+)?)/u.exec(decoded);
  if (!match) {
    return null;
  }

  const first = Number.parseFloat(match[1]);
  const second = Number.parseFloat(match[2]);
  if (!Number.isFinite(first) || !Number.isFinite(second)) {
    return null;
  }

  const asLonLat = { latitude: second, longitude: first } satisfies Coordinates;
  if (isValidCoordinate(asLonLat.latitude, asLonLat.longitude)) {
    return asLonLat;
  }

  const asLatLon = { latitude: first, longitude: second } satisfies Coordinates;
  if (isValidCoordinate(asLatLon.latitude, asLatLon.longitude)) {
    return asLatLon;
  }

  return null;
};

const formatCoordinates = (latitude: number, longitude: number): string =>
  `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;

const KNOWN_2GIS_DOMAINS = [
  '2gis.kz',
  '2gis.ru',
  '2gis.ua',
  '2gis.com',
  '2gis.kg',
  '2gis.az',
  'go.2gis.com',
];

const is2GisHostname = (hostname: string): boolean => {
  const lower = hostname.toLowerCase();
  return KNOWN_2GIS_DOMAINS.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
};

interface Parsed2GisLink extends Coordinates {
  url: URL;
  label?: string;
}

const extract2GisLabel = (url: URL): string | undefined => {
  const candidateParams = ['q', 'query', 'name', 'what', 'text', 'title'];
  for (const param of candidateParams) {
    const value = url.searchParams.get(param);
    if (value) {
      const decoded = decodeComponent(value).replace(/\+/gu, ' ').trim();
      if (decoded) {
        return decoded;
      }
    }
  }

  const segments = url.pathname
    .split('/')
    .map((segment) => decodeComponent(segment).replace(/\+/gu, ' ').trim())
    .filter((segment) => segment.length > 0);

  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (!segment) {
      continue;
    }

    if (/^-?\d+(?:\.\d+)?$/u.test(segment)) {
      continue;
    }

    if (/^\d+$/u.test(segment)) {
      continue;
    }

    return segment;
  }

  return undefined;
};

const collectCandidatePairs = (url: URL): string[] => {
  const candidates = new Set<string>();

  const addCandidate = (value: string | null | undefined): void => {
    if (value) {
      candidates.add(value);
    }
  };

  addCandidate(url.searchParams.get('m'));
  addCandidate(url.searchParams.get('ll'));
  addCandidate(url.searchParams.get('center'));
  addCandidate(url.searchParams.get('point'));
  addCandidate(url.searchParams.get('coordinates'));

  const route = url.searchParams.get('r');
  if (route) {
    const decoded = decodeComponent(route);
    const [firstSegment] = decoded.split('|');
    addCandidate(firstSegment);
  }

  const latParam = url.searchParams.get('lat') ?? url.searchParams.get('latitude');
  const lonParam =
    url.searchParams.get('lon') ?? url.searchParams.get('lng') ?? url.searchParams.get('longitude');
  if (latParam && lonParam) {
    addCandidate(`${lonParam},${latParam}`);
    addCandidate(`${latParam},${lonParam}`);
  }

  if (url.hash.length > 1) {
    const hash = url.hash.slice(1);
    const hashParams = new URLSearchParams(hash);

    addCandidate(hashParams.get('m'));
    addCandidate(hashParams.get('ll'));
    addCandidate(hashParams.get('center'));
    addCandidate(hashParams.get('point'));

    const hashRoute = hashParams.get('r');
    if (hashRoute) {
      const decodedHashRoute = decodeComponent(hashRoute);
      const [firstHashSegment] = decodedHashRoute.split('|');
      addCandidate(firstHashSegment);
    }

    const hashLat = hashParams.get('lat') ?? hashParams.get('latitude');
    const hashLon =
      hashParams.get('lon') ?? hashParams.get('lng') ?? hashParams.get('longitude');
    if (hashLat && hashLon) {
      addCandidate(`${hashLon},${hashLat}`);
      addCandidate(`${hashLat},${hashLon}`);
    }
  }

  const searchAndHash = `${decodeComponent(url.search)}${decodeComponent(url.hash)}`;
  const genericPattern = /(-?\d{1,3}(?:\.\d+)?)[,/%\s]+(-?\d{1,3}(?:\.\d+)?)/gu;
  for (const match of searchAndHash.matchAll(genericPattern)) {
    const [first, second] = match.slice(1);
    addCandidate(`${first},${second}`);
  }

  const path = decodeComponent(url.pathname);
  for (const match of path.matchAll(genericPattern)) {
    const [first, second] = match.slice(1);
    addCandidate(`${first},${second}`);
  }

  return Array.from(candidates);
};

const parse2GisLink = (value: string): Parsed2GisLink | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    try {
      url = new URL(`https://${value}`);
    } catch {
      return null;
    }
  }

  if (!is2GisHostname(url.hostname)) {
    return null;
  }

  const candidates = collectCandidatePairs(url);
  for (const candidate of candidates) {
    const coordinates = parseCoordinatePair(candidate);
    if (coordinates) {
      return { ...coordinates, url, label: extract2GisLabel(url) } satisfies Parsed2GisLink;
    }
  }

  return null;
};

interface TwoGisPoint {
  lat?: number | string;
  lon?: number | string;
}

interface TwoGisItem {
  point?: TwoGisPoint;
  full_name?: string;
  address_name?: string;
  name?: string;
}

interface TwoGisResponse {
  result?: {
    items?: TwoGisItem[];
  };
}

interface TwoGisConfig {
  apiKey: string;
  baseUrl: string;
  locale?: string;
  regionId?: string;
  timeoutMs: number;
}

const getTwoGisConfig = (): TwoGisConfig | null => {
  const apiKey = getFirstDefinedEnv(
    'GEOCODER_2GIS_KEY',
    'GEOCODER_DGIS_KEY',
    'DGIS_API_KEY',
    'TWOGIS_API_KEY',
    'TWO_GIS_API_KEY',
    'TWO_GIS_KEY',
  );

  if (!apiKey) {
    return null;
  }

  const baseUrl =
    getFirstDefinedEnv('TWOGIS_GEOCODE_URL', 'GEOCODER_2GIS_URL') ??
    'https://catalog.api.2gis.com/3.0/items/geocode';

  const locale = getFirstDefinedEnv('TWOGIS_LOCALE', 'GEOCODER_2GIS_LOCALE');
  const regionId = getFirstDefinedEnv('TWOGIS_REGION_ID', 'GEOCODER_2GIS_REGION_ID');
  const timeoutMs = parseTimeout(
    getFirstDefinedEnv('TWOGIS_TIMEOUT_MS', 'GEOCODER_2GIS_TIMEOUT_MS'),
    DEFAULT_TIMEOUT_MS,
  );

  return {
    apiKey,
    baseUrl,
    locale: locale ?? undefined,
    regionId: regionId ?? undefined,
    timeoutMs,
  } satisfies TwoGisConfig;
};

interface NominatimSearchResult {
  display_name?: string;
  lat: string;
  lon: string;
}

interface NominatimReverseResult {
  display_name?: string;
}

interface NominatimConfig {
  searchUrl: string;
  reverseUrl: string;
  apiKey?: string;
  apiKeyParam?: string;
  userAgent: string;
  referer?: string;
  language?: string;
  email?: string;
  timeoutMs: number;
}

const resolveNominatimApiKeyParam = (hostname: string, explicit?: string | null): string | null => {
  if (explicit) {
    return explicit;
  }

  const lower = hostname.toLowerCase();
  if (lower.includes('nominatim.openstreetmap.org')) {
    return null;
  }

  if (lower.includes('maps.co')) {
    return 'api_key';
  }

  return 'key';
};

const getNominatimConfig = (): NominatimConfig => {
  const searchUrl =
    getFirstDefinedEnv('NOMINATIM_SEARCH_URL', 'NOMINATIM_URL', 'GEOCODER_NOMINATIM_URL') ??
    'https://nominatim.openstreetmap.org/search';

  const reverseUrl =
    getFirstDefinedEnv('NOMINATIM_REVERSE_URL', 'GEOCODER_NOMINATIM_REVERSE_URL') ??
    (searchUrl.includes('/search')
      ? searchUrl.replace(/\/search(?:\.php)?$/u, '/reverse')
      : 'https://nominatim.openstreetmap.org/reverse');

  const apiKey = getFirstDefinedEnv(
    'NOMINATIM_API_KEY',
    'NOMINATIM_KEY',
    'GEOCODER_NOMINATIM_KEY',
    'GEOCODER_NOMINATIM_API_KEY',
    'GEOCODER_OSM_KEY',
  );

  const explicitApiKeyParam = getFirstDefinedEnv(
    'NOMINATIM_API_KEY_PARAM',
    'GEOCODER_NOMINATIM_KEY_PARAM',
    'GEOCODER_NOMINATIM_API_KEY_PARAM',
  );

  const searchHost = new URL(searchUrl).hostname;
  const apiKeyParam = apiKey
    ? resolveNominatimApiKeyParam(searchHost, explicitApiKeyParam)
    : undefined;

  const userAgent =
    getFirstDefinedEnv('NOMINATIM_USER_AGENT', 'GEOCODER_NOMINATIM_USER_AGENT') ?? 'freedom-bot/1.1.0';

  const referer = getFirstDefinedEnv('NOMINATIM_REFERER', 'GEOCODER_NOMINATIM_REFERER');
  const language = getFirstDefinedEnv('NOMINATIM_ACCEPT_LANGUAGE', 'GEOCODER_NOMINATIM_LANGUAGE');
  const email = getFirstDefinedEnv('NOMINATIM_EMAIL', 'GEOCODER_NOMINATIM_EMAIL');
  const timeoutMs = parseTimeout(
    getFirstDefinedEnv('NOMINATIM_TIMEOUT_MS', 'GEOCODER_NOMINATIM_TIMEOUT_MS'),
    DEFAULT_TIMEOUT_MS,
  );

  return {
    searchUrl,
    reverseUrl,
    apiKey: apiKey ?? undefined,
    apiKeyParam: apiKeyParam ?? undefined,
    userAgent,
    referer: referer ?? undefined,
    language: language ?? undefined,
    email: email ?? undefined,
    timeoutMs,
  } satisfies NominatimConfig;
};

const fetchJson = async <T>(
  url: URL,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> => {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
};

const buildNominatimHeaders = (config: NominatimConfig): Record<string, string> => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': config.userAgent,
  };

  if (config.referer) {
    headers.Referer = config.referer;
  }

  if (config.language) {
    headers['Accept-Language'] = config.language;
  }

  if (config.email) {
    headers.From = config.email;
  }

  return headers;
};

const applyNominatimKey = (url: URL, config: NominatimConfig): void => {
  if (!config.apiKey) {
    return;
  }

  const paramName = resolveNominatimApiKeyParam(url.hostname, config.apiKeyParam);
  if (!paramName) {
    return;
  }

  url.searchParams.set(paramName, config.apiKey);
};

const geocodeWithTwoGis = async (
  query: string,
  normalizedQuery: string,
  config: TwoGisConfig,
): Promise<GeocodingResult | null> => {
  const url = new URL(config.baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('page', '1');
  url.searchParams.set('page_size', '1');
  url.searchParams.set('fields', 'items.point,items.full_name,items.address_name,items.name');
  url.searchParams.set('key', config.apiKey);

  if (config.locale) {
    url.searchParams.set('locale', config.locale);
  }

  if (config.regionId) {
    url.searchParams.set('region_id', config.regionId);
  }

  try {
    const response = await fetchJson<TwoGisResponse>(url, {
      headers: { Accept: 'application/json' },
      timeoutMs: config.timeoutMs,
    });

    const items = response.result?.items ?? [];
    for (const item of items) {
      const point = item.point;
      if (!point) {
        continue;
      }

      const latitude =
        typeof point.lat === 'string' ? Number.parseFloat(point.lat) : point.lat ?? Number.NaN;
      const longitude =
        typeof point.lon === 'string' ? Number.parseFloat(point.lon) : point.lon ?? Number.NaN;

      if (!isValidCoordinate(latitude, longitude)) {
        continue;
      }

      const address = item.full_name ?? item.address_name ?? item.name ?? normalizedQuery;

      return {
        query: normalizedQuery,
        address,
        latitude,
        longitude,
      } satisfies GeocodingResult;
    }
  } catch {
    // Ignore 2GIS errors and fall back to other providers.
  }

  return null;
};

const geocodeWithNominatim = async (
  query: string,
  normalizedQuery: string,
  config: NominatimConfig,
): Promise<GeocodingResult | null> => {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(config.searchUrl);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '1');

    applyNominatimKey(url, config);

    const results = await fetchJson<NominatimSearchResult[]>(url, {
      headers: buildNominatimHeaders(config),
      timeoutMs: config.timeoutMs,
    });

    const [first] = results;
    if (!first) {
      return null;
    }

    const latitude = Number.parseFloat(first.lat);
    const longitude = Number.parseFloat(first.lon);
    if (!isValidCoordinate(latitude, longitude)) {
      return null;
    }

    const address = first.display_name?.trim() || trimmed;
    return {
      query: normalizedQuery,
      address,
      latitude,
      longitude,
    } satisfies GeocodingResult;
  } catch {
    return null;
  }
};

const reverseGeocodeWithNominatim = async (
  latitude: number,
  longitude: number,
  config: NominatimConfig,
): Promise<string | null> => {
  try {
    const url = new URL(config.reverseUrl);
    url.searchParams.set('lat', latitude.toString());
    url.searchParams.set('lon', longitude.toString());
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('addressdetails', '1');
    url.searchParams.set('zoom', '18');

    applyNominatimKey(url, config);

    const result = await fetchJson<NominatimReverseResult>(url, {
      headers: buildNominatimHeaders(config),
      timeoutMs: config.timeoutMs,
    });

    return result.display_name?.trim() ?? null;
  } catch {
    return null;
  }
};

export const geocodeAddress = async (
  query: string,
): Promise<GeocodingResult | null> => {
  if (!query) {
    return null;
  }

  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return null;
  }

  const normalizedQuery = normaliseQuery(trimmed);

  const nominatimConfig = getNominatimConfig();
  const parsedLink = parse2GisLink(trimmed);
  if (parsedLink) {
    const { latitude, longitude, label } = parsedLink;
    const fallbackAddress = label ?? `Координаты ${formatCoordinates(latitude, longitude)}`;

    const resolvedAddress = await reverseGeocodeWithNominatim(
      latitude,
      longitude,
      nominatimConfig,
    );

    return {
      query: normalizedQuery,
      address: resolvedAddress ?? fallbackAddress,
      latitude,
      longitude,
    } satisfies GeocodingResult;
  }

  const providers: Array<() => Promise<GeocodingResult | null>> = [];
  const twoGisConfig = getTwoGisConfig();
  if (twoGisConfig) {
    providers.push(() => geocodeWithTwoGis(normalizedQuery, normalizedQuery, twoGisConfig));
  }

  providers.push(() => geocodeWithNominatim(normalizedQuery, normalizedQuery, nominatimConfig));

  for (const provider of providers) {
    const result = await provider();
    if (result) {
      return result;
    }
  }

  return null;
};
