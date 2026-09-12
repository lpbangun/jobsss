// Bundled JobSSS discovery module — standalone offline discovery helpers.
// Attributed ports (JobOS remains MIT, see root LICENSE; never imported at runtime):
//   - URL safety: JobOS src/discovery/http.js publicUrl() + isBlockedIp()
//   - job text parsing + dedupe rules: JobOS src/jobs.js parseJob(), dedupeKey(),
//     canMergeByKey(), importNormalized()
//   - offline Greenhouse board normalization: JobOS src/discovery/adapters.js
//     greenhouse.fetchJobs() + normalizedJob() (HTML-to-text without cheerio)
//   - liveness: JobOS src/discovery/liveness.js classifyLiveness(),
//     normalizeLiveness(), postingLivenessHandoff()
//   - discovery run outputs: JobOS src/discovery.js runSavedSearch(),
//     deriveDiscoveryStatus()
//
// Wave 2 contract (see BENCHMARK.md B16/B19/B20):
//   - job URL intake is http/https public-host only; file:/private/credentialed
//     URLs and arbitrary filesystem paths are rejected
//   - discovery is offline: fixture-backed ATS boards read JSON only from
//     inside the host PLUGIN_DATA directory; no API keys, no network
//   - discovered jobs are normalized and deduplicated into the canonical store
//     object as database-only records; this module never creates any files,
//     folders, or application artifacts (save/pursue is owned by the parent)
import { parseCompensation } from './compensation.js';
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { id, now, hashText, dedupeKeyForJob, ensureDataDir } from './store.js';

export const OFFLINE_ADAPTERS = Object.freeze(['greenhouse']);
export const DISCOVERY_OUTPUTS_VERSION = 2;
export const LIVENESS_FRESH_MS = 86_400_000; // 24h, JobOS FRESH_WINDOW_MS

// ---------------------------------------------------------------------------
// URL safety (B16) — port of JobOS publicUrl() + isBlockedIp().
// ---------------------------------------------------------------------------

function ipv4Blocked(address) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false;
  const octets = address.split('.').map(Number);
  if (octets.some(value => value > 255)) return false;
  const [a, b, c] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0 || a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113);
}

function ipv6Blocked(address) {
  const normalized = String(address).split('%')[0].toLowerCase();
  return normalized === '::' || normalized === '::1'
    || normalized.startsWith('fc') || normalized.startsWith('fd')
    || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
    || normalized.startsWith('2001:db8:');
}

function isBlockedIp(value) {
  let address = String(value || '').split('%')[0].toLowerCase();
  if (address.startsWith('::ffff:')) address = address.slice(7);
  if (address.includes(':') && address.includes('.')) {
    // IPv4-mapped forms already handled above; otherwise treat as IPv6.
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return ipv6Blocked('::ffff:' + address);
  }
  if (address.includes(':')) return ipv6Blocked(address);
  return ipv4Blocked(address);
}

/**
 * Validate and normalize a job URL. Rejects non-http(s) schemes (including
 * file:), credentialed URLs, and non-public hosts. Returns the URL object.
 * Throws with a stable `code` for MCP error mapping.
 */
export function assertPublicJobUrl(value) {
  if (value == null || String(value).trim() === '') {
    throw Object.assign(new Error('A job URL is required'), { code: 'missing_url' });
  }
  let parsed;
  try {
    parsed = new URL(String(value).trim());
  } catch {
    throw Object.assign(new Error(`Invalid job URL: ${value}`), { code: 'invalid_url' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(
      new Error(`Unsupported job URL protocol ${parsed.protocol}; only public http/https URLs are accepted (file paths and file: URLs are not readable by MCP).`),
      { code: 'unsafe_url_protocol', details: { protocol: parsed.protocol } }
    );
  }
  if (parsed.username || parsed.password) {
    throw Object.assign(new Error('Job URLs must not contain credentials'), { code: 'credentialed_url' });
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || hostname.endsWith('.internal') || hostname.endsWith('.home.arpa') || isBlockedIp(hostname)) {
    throw Object.assign(new Error(`Job URL must use a public host: ${hostname}`), { code: 'non_public_host', details: { hostname } });
  }
  parsed.hash = '';
  return parsed;
}

export function normalizeJobUrl(value) {
  try {
    return assertPublicJobUrl(value).href;
  } catch {
    return '';
  }
}

export async function assertPublicNetworkUrl(value, { lookupImpl = dns.lookup } = {}) {
  const parsed = assertPublicJobUrl(value);
  let records;
  try { records = await lookupImpl(parsed.hostname, { all: true, verbatim: true }); }
  catch (cause) { throw Object.assign(new Error(`Cannot resolve public job host: ${cause.message}`), { code: 'url_dns_error' }); }
  if (!records.length || records.some(record => isBlockedIp(record.address))) {
    throw Object.assign(new Error('Job URL resolved to a non-public network address.'), { code: 'non_public_address' });
  }
  return parsed;
}

async function fetchPublicResource(value, { fetchImpl = globalThis.fetch, lookupImpl = dns.lookup, timeoutMs = 12_000, maxBytes = 2 * 1024 * 1024 } = {}) {
  let url = (await assertPublicNetworkUrl(value, { lookupImpl })).href;
  for (let redirects = 0; redirects <= 4; redirects += 1) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'JobSSS standalone (+human-initiated public intake)', accept: 'application/json,text/html,text/plain' },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects === 4) throw Object.assign(new Error('Public job URL redirect limit exceeded.'), { code: 'url_redirect_error' });
      url = (await assertPublicNetworkUrl(new URL(location, url).href, { lookupImpl })).href;
      continue;
    }
    if (!response.ok) throw Object.assign(new Error(`Public job URL returned HTTP ${response.status}`), { code: 'url_http_error' });
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) throw Object.assign(new Error('Public job response exceeds size limit.'), { code: 'url_response_too_large' });
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw Object.assign(new Error('Public job response exceeds size limit.'), { code: 'url_response_too_large' });
    return { url, text, contentType: response.headers.get('content-type') || '', status: response.status };
  }
  throw Object.assign(new Error('Public job URL redirect failed.'), { code: 'url_redirect_error' });
}

function jobPostingJsonLd(html) {
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const candidates = Array.isArray(parsed) ? parsed : parsed?.['@graph'] || [parsed];
      const posting = candidates.find(item => item?.['@type'] === 'JobPosting' || (Array.isArray(item?.['@type']) && item['@type'].includes('JobPosting')));
      if (posting) return posting;
    } catch { /* malformed page metadata: fall back to visible text */ }
  }
  return null;
}

export async function fetchPublicJob(value, options = {}) {
  const resource = await fetchPublicResource(value, options);
  const posting = jobPostingJsonLd(resource.text);
  const visible = stripHtml(resource.text).slice(0, 50_000);
  const pageTitle = stripHtml(resource.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const greenhouseTitle = pageTitle.match(/^Job Application for (.+) at (.+)$/i);
  const location = posting?.jobLocation?.address;
  const locationText = typeof location === 'string' ? location : [location?.addressLocality, location?.addressRegion, location?.addressCountry].filter(Boolean).join(', ');
  return {
    title: String(posting?.title || greenhouseTitle?.[1] || pageTitle || 'Imported URL role').trim(),
    company: String(posting?.hiringOrganization?.name || greenhouseTitle?.[2] || 'Unknown company').trim(),
    location: locationText || '',
    description: stripHtml(posting?.description || '') || visible,
    url: resource.url,
    source: 'public_url',
    sourceId: resource.url,
    postedDate: String(posting?.datePosted || ''),
    compensation: posting?.baseSalary || '',
    workModel: workModelFromLocation(locationText, `${posting?.jobLocationType || ''} ${visible}`),
    fetchStatus: 'fetched',
    fetchedAt: now(),
    httpStatus: resource.status,
  };
}

/**
 * Build the degraded "URL import recorded" job draft (JobOS importUrl fallback,
 * offline). Content is never fetched here; the parent decides whether a
 * fetchImpl is permitted. Never claims the posting was read successfully.
 */
export function urlImportFallbackJob({ profileId, url, source = 'url', note = '' }) {
  const safeUrl = String(url || '').trim();
  return {
    profileId,
    title: 'Imported URL role',
    company: 'Unknown company',
    location: '',
    url: safeUrl,
    source,
    sourceId: `url:${hashText(safeUrl)}`,
    description: `# Imported URL role\n\nCompany: Unknown company\nSource URL: ${safeUrl}\n\nURL import was recorded, but content fetch was not performed by the offline bundled runtime.${note ? ` ${note}` : ''}\nManual enrichment is required before scoring or tailoring.`,
    postedDate: '',
    sourceHash: hashText(`url:${safeUrl}`),
    fetchStatus: 'recorded_only',
    requiresManualEnrichment: true,
    liveness: manualUncertainLiveness({ url: safeUrl, source }),
  };
}

// ---------------------------------------------------------------------------
// Job text parsing (B16/B19) — port of JobOS jobs.js parseJob().
// ---------------------------------------------------------------------------

function companyName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length > 90 || /;/.test(text)) return '';
  if (/^(fictional|unknown company)\b/i.test(text)) return '';
  if (/\b(supports product|workflow software business|its fictional)\b/i.test(text)) return '';
  return text;
}

function identityCompany(value) {
  const text = companyName(value);
  if (!text || !/^\p{Lu}/u.test(text)) return '';
  const descriptor = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:remote|remote only|hybrid|onsite|on site|in office|full time|part time|contract|contractor|freelance|temporary|permanent|intern|internship|volunteer)$/.test(descriptor)) return '';
  const connector = /^(?:of|the|and|for|at|de|du|van|von|la|le)$/i;
  const words = text.split(/\s+/).filter(word => word !== '&');
  if (words.some(word => !connector.test(word) && !/^\p{Lu}[\p{L}\p{M}\p{N}'().,/&-]*$/u.test(word))) return '';
  return text;
}

function identityLocation(value) {
  const text = String(value || '').trim();
  if (!text || text.length > 120 || /[.!?;:]/.test(text)) return '';
  const parts = text.split(/\s*,\s*/);
  if (parts.length < 2 || parts.some(part => !/^\p{Lu}[\p{L}\p{M}\p{N}'()./ -]*$/u.test(part))) return '';
  return text;
}

function headingIdentity(lines) {
  const headingIndex = lines.findIndex(line => /^#{1,6}\s+/.test(line));
  if (headingIndex < 0) return { title: '', company: '', location: '' };
  const heading = lines[headingIndex];
  const body = heading.replace(/^#{1,6}\s+/, '').trim();
  // Strip a leading posting id ("J03 — Analytics Engineer ...") only when the
  // id is separated by a spaced dash: a hyphen inside a real title ("24-7
  // Support Engineer", "3-6 years") is never an id prefix.
  const withoutId = body.replace(/^[A-Z]{0,2}\d{1,4}\s+[—–-]\s+/, '');
  // A title-only Markdown heading followed immediately by one em-dash
  // identity line is the narrowly supported company/location form. Requiring
  // a comma-separated, title-cased location keeps ordinary prose out.
  if (!/\s+[—–-]\s+/.test(withoutId) && !/\s+at\s+/i.test(withoutId)) {
    const identity = lines[headingIndex + 1]?.match(/^([^—\n]{1,90}?)\s+—\s+([^—\n]{1,120})$/);
    const identityCompanyName = identityCompany(identity?.[1]);
    const identityPlace = identityLocation(identity?.[2]);
    if (identityCompanyName && identityPlace) {
      return { title: withoutId, company: identityCompanyName, location: identityPlace };
    }
  }
  const parts = withoutId.split(/\s+[—–-]\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { title: parts[0], company: parts.slice(1).join(' — '), location: '' };
  const at = withoutId.match(/^(.+?)\s+at\s+(.+)$/i);
  if (at) return { title: at[1].trim(), company: at[2].trim(), location: '' };
  return { title: withoutId, company: '', location: '' };
}

export function parseJobText(text, fallback = {}) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const find = key => {
    const re = new RegExp(`^${key}\\s*:\\s*`, 'i');
    const line = lines.find(value => re.test(value));
    return line ? line.replace(re, '').trim() : '';
  };
  const heading = headingIdentity(lines);
  const workModelText = String(fallback.workModel || find('work model') || '').trim().toLowerCase();
  const workModel = /\bhybrid\b/.test(workModelText) ? 'hybrid'
    : /\bremote\b/.test(workModelText) ? 'remote'
      : /\b(on[- ]?site|in office)\b/.test(workModelText) ? 'onsite' : 'unknown';
  const sourceUrl = find('source url');
  const labeledCompany = companyName(find('company'));
  const headingCompany = companyName(heading.company);
  const labeledCompensation = find('compensation');
  const baseSalary = find('base salary');
  const salary = find('salary');
  const pay = find('pay');
  const payFallback = Boolean(!fallback.compensation && !labeledCompensation && !baseSalary && !salary && pay);
  const compensation = fallback.compensation || labeledCompensation || baseSalary || salary || pay || '';
  const compensationSource = fallback.compensation || labeledCompensation
    || (baseSalary ? `Base salary: ${baseSalary}` : '')
    || (salary ? `Salary: ${salary}` : '')
    || (pay ? `Pay: ${pay}` : '')
    || text;
  const parsedCompensation = parseCompensation(compensationSource);
  const compensationJson = payFallback && parsedCompensation.min === null && parsedCompensation.max === null
    ? parseCompensation(text)
    : parsedCompensation;
  return {
    title: fallback.title || find('title') || heading.title || 'Imported role',
    company: fallback.company || labeledCompany || headingCompany || 'Unknown company',
    location: fallback.location || find('location') || find('location/authorization') || heading.location || '',
    compensation,
    compensationJson,
    workModel,
    url: fallback.url || sourceUrl || '',
    description: text,
  };
}

// ---------------------------------------------------------------------------
// Normalization and dedupe (B19) — port of JobOS importNormalized() rules.
// ---------------------------------------------------------------------------

function textLikeUrl(value) {
  const url = String(value || '').trim();
  return url.startsWith('http://') || url.startsWith('https://') ? url : '';
}

/**
 * Find an existing profile-owned job that the incoming job should merge with.
 * JobOS-faithful: same public URL wins; otherwise same source+sourceId; for
 * text-like records (no public URL on either side) same sourceHash. A partner
 * record that has a public URL never collapses with a text/pseudo-URL record
 * that merely shares the dedupeKey.
 */
export function findDuplicateJob(store, { profileId, job }) {
  const candidates = Object.values(store.jobs || {}).filter(existing => existing.profileId === profileId);
  const incomingUrl = textLikeUrl(job.url);
  if (incomingUrl) {
    const byUrl = candidates.find(existing => textLikeUrl(existing.url) === incomingUrl);
    if (byUrl) return { existing: byUrl, reason: 'url' };
  }
  const sourceId = String(job.sourceId || '').trim();
  if (sourceId) {
    const bySource = candidates.find(existing =>
      String(existing.source || '') === String(job.source || '')
      && String(existing.sourceId || '') === sourceId
    );
    if (bySource) return { existing: bySource, reason: 'sourceId' };
  }
  if (!incomingUrl) {
    const incomingHash = String(job.sourceHash || '');
    const incomingKey = dedupeKeyForJob(job);
    const byHash = candidates.find(existing => !textLikeUrl(existing.url) && String(existing.sourceHash || '') === incomingHash && incomingHash);
    if (byHash) return { existing: byHash, reason: 'text' };
    const byKey = candidates.find(existing => !textLikeUrl(existing.url) && existing.dedupeKey === incomingKey && String(existing.source || '').startsWith('text'));
    if (byKey) return { existing: byKey, reason: 'text' };
  }
  return null;
}

export function normalizeDiscoveryJob(job, { profileId, source, sourceId, runId, at }) {
  const description = String(job.description || job.content || '').trim();
  const key = dedupeKeyForJob(job);
  const publicUrl = textLikeUrl(job.url);
  const seed = publicUrl || sourceId || `text:${hashText(description)}`;
  return {
    id: id('job', `${profileId}:${source}:${seed}:${key}`),
    jobId: id('job', `${profileId}:${source}:${seed}:${key}`),
    profileId,
    title: String(job.title || '').trim() || 'Imported role',
    company: String(job.company || '').trim() || 'Unknown company',
    location: String(job.location || '').trim() || '',
    url: publicUrl,
    source: String(source || 'discovery'),
    sourceId: String(sourceId || ''),
    description,
    postedDate: String(job.postedDate || job.posted_date || '').trim(),
    compensation: job.compensation && typeof job.compensation === 'object'
      ? job.compensation
      : { text: String(job.compensation || '').trim() },
    workModel: ['remote', 'hybrid', 'onsite', 'unknown'].includes(job.workModel) ? job.workModel : 'unknown',
    employmentTypes: Array.isArray(job.employmentTypes) ? [...new Set(job.employmentTypes)] : [],
    department: String(job.department || '').trim(),
    sourceHash: hashText(String(job.sourceHash || (publicUrl ? `url:${publicUrl}` : description))),
    dedupeKey: key,
    discovered: true,
    saved: false,
    status: 'new',
    discoveryRunId: runId || '',
    createdAt: at,
    updatedAt: at,
    lastSeenAt: at,
  };
}

/**
 * Import a discovered job into the store object (database-only). Never writes
 * files or folders. Returns { job, created, deduped }.
 */
export function importDiscoveredJob(store, { profileId, job, source, sourceId, runId, at }) {
  const normalized = normalizeDiscoveryJob(job, { profileId, source, sourceId, runId, at });
  const duplicate = findDuplicateJob(store, { profileId, job: normalized });
  if (duplicate) {
    const existing = duplicate.existing;
    // Refresh liveness/last-seen touches only meta fields; identity is stable.
    if (job.liveness) existing.liveness = job.liveness;
    if (runId && !existing.discoveryRunId) existing.discoveryRunId = runId;
    existing.lastSeenAt = at;
    existing.updatedAt = at;
    return { job: existing, created: false, deduped: true };
  }
  store.jobs = store.jobs || {};
  if (job.liveness) normalized.liveness = job.liveness;
  store.jobs[normalized.id] = normalized;
  return { job: normalized, created: true, deduped: false };
}

// ---------------------------------------------------------------------------
// Liveness (B19/B22) — port of JobOS discovery/liveness.js lite.
// ---------------------------------------------------------------------------

function evidence(kind, value) {
  return { kind, value: String(value ?? '') };
}

function isoFromEpochMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

export function manualUncertainLiveness({ url = '', source = 'discovery', jobId = '' }) {
  return {
    version: 1,
    jobId: String(jobId || ''),
    status: 'uncertain',
    checkedAt: null,
    requestedUrl: String(url || ''),
    finalUrl: '',
    httpStatus: null,
    reasonCodes: ['manual_import'],
    evidence: [evidence('manual_import', 'no_public_url')],
    source: String(source || 'discovery'),
    freshUntil: null,
  };
}

export function listingLiveness({ url, hint, source = 'discovery', jobId = '', nowMs = Date.now() }) {
  const requestedUrl = String(url || (hint && hint.request && hint.request.requestedUrl) || '');
  const httpStatus = hint && hint.request ? Number(hint.request.httpStatus) : 200;
  const sameListing = hint && (hint.kind === 'listed_in_public_ats' || hint.kind === 'listed_on_career_page')
    && httpStatus === 200;
  const checkedAtMs = nowMs;
  const checkedAt = isoFromEpochMs(checkedAtMs);
  const status = sameListing ? 'active' : 'uncertain';
  return {
    version: 1,
    jobId: String(jobId || ''),
    status,
    checkedAt,
    requestedUrl,
    finalUrl: requestedUrl,
    httpStatus: status === 'active' ? httpStatus : null,
    reasonCodes: status === 'active' ? ['listed_in_current_listing'] : ['offline_uncertain'],
    evidence: status === 'active'
      ? [evidence('ats_listing', `${hint.kind}:${httpStatus}`)]
      : [evidence('offline', 'no_listing_hint')],
    source: String(source || 'discovery'),
    freshUntil: status === 'active' ? isoFromEpochMs(checkedAtMs + LIVENESS_FRESH_MS) : null,
  };
}

function asEpochMs(value, fallback = Date.now()) {
  if (value == null) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : fallback;
}

export function classifyLiveness(job = {}, opts = {}) {
  const url = String(job.url || '');
  if (!/^https?:\/\//i.test(url) && !job.livenessHint) {
    return manualUncertainLiveness({ url, source: job.source, jobId: job.jobId || job.id });
  }
  if (job.livenessHint && (job.livenessHint.kind === 'listed_in_public_ats' || job.livenessHint.kind === 'listed_on_career_page')) {
    return listingLiveness({
      url,
      hint: job.livenessHint,
      source: job.source,
      jobId: job.jobId || job.id,
      nowMs: opts.now ? asEpochMs(opts.now()) : Date.now(),
    });
  }
  return manualUncertainLiveness({ url, source: job.source, jobId: job.jobId || job.id });
}

export function postingLivenessHandoff(liveness) {
  const value = liveness && typeof liveness === 'object' ? liveness : {};
  return {
    contract: 'jobos.posting-liveness.v1',
    jobId: String(value.jobId || ''),
    status: ['active', 'expired', 'uncertain'].includes(value.status) ? value.status : 'uncertain',
    checkedAt: value.checkedAt || null,
    reasonCodes: Array.isArray(value.reasonCodes) ? value.reasonCodes.map(String) : [],
    source: String(value.source || ''),
  };
}

// ---------------------------------------------------------------------------
// Offline Greenhouse board adapter (B19/B20) — port of JobOS greenhouse.
// ---------------------------------------------------------------------------

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&') // decoded last so &amp;nbsp; collapses correctly
    .replace(/\s+/g, ' ')
    .trim();
}

function metadataValue(metadata, names) {
  const wanted = names.map(name => name.toLowerCase());
  for (const item of Array.isArray(metadata) ? metadata : []) {
    const name = String(item && (item.name || item.label || item.key) || '').trim().toLowerCase();
    if (wanted.includes(name)) {
      const value = item?.value ?? item?.values ?? item?.text ?? null;
      return value;
    }
  }
  return null;
}

function parseCompensationText(value) { return parseCompensation(value); }

function workModelFromLocation(location, description = '') {
  const locationText = String(location || '').toLowerCase();
  const body = String(description || '').toLowerCase();
  if (/\bhybrid\b/.test(locationText) || /\bhybrid\b/.test(body)) return 'hybrid';
  if (/\b(remote|telecommute|distributed)\b/.test(locationText) || /\bremote work is available\b/.test(body) || /\bremote\b/i.test(locationText)) return 'remote';
  if (/\b(on[- ]?site|in office|in[- ]?person)\b/.test(locationText) || /\bon[- ]?site\b/.test(body)) return 'onsite';
  return /\bremote\b/i.test(locationText) ? 'remote' : 'unknown';
}

function employmentTypeFrom(value) {
  const text = String(value || '').toLowerCase().replace(/[_-]+/g, ' ');
  if (!text) return null;
  if (/\bfull\s*time\b/.test(text)) return 'full_time';
  if (/\bpart\s*time\b/.test(text)) return 'part_time';
  if (/\bcontract|freelance\b/.test(text)) return 'contract';
  if (/\btemp|temporary\b/.test(text)) return 'temporary';
  if (/\bintern\b/.test(text)) return 'internship';
  if (/\bvolunteer\b/.test(text)) return 'volunteer';
  return 'other';
}

function greenhouseCompany(config) {
  return String(config.companyLabel || config.company || config.boardToken || config.board_token || '').trim() || 'Unknown company';
}

/**
 * Resolve a discovery fixture against PLUGIN_DATA and enforce the B16
 * arbitrary-path boundary. Resolution is rooted at PLUGIN_DATA, never at the
 * server process cwd, so a relative fixture means "relative to PLUGIN_DATA".
 * Absolute paths outside PLUGIN_DATA, `..` traversal, symlinks escaping the
 * directory, and missing/non-file targets are rejected with a typed error
 * naming the expected location. Returns { dataDir, absolute, relative }.
 */
export function resolveDiscoveryFixturePath(fixture, dataDir) {
  const requested = fixture == null ? '' : String(fixture).trim();
  if (!requested) {
    throw Object.assign(new Error('Offline ATS discovery requires a fixture path inside PLUGIN_DATA'), { code: 'offline_adapter_requires_fixture' });
  }
  const dataReal = fs.realpathSync(ensureDataDir(dataDir));
  const inside = value => value === dataReal || value.startsWith(`${dataReal}${path.sep}`);
  // path.resolve(dataReal, requested) roots a relative fixture at PLUGIN_DATA
  // and leaves an absolute one as-is; the process cwd is never consulted.
  const expected = path.resolve(dataReal, requested);
  const outside = value => Object.assign(
    new Error(`Discovery fixture must resolve inside PLUGIN_DATA (${dataReal}); ${requested} is not a PLUGIN_DATA-relative fixture`),
    { code: 'fixture_outside_data_dir', details: { fixture: requested, resolved: value, dataDir: dataReal } }
  );
  if (!inside(expected)) throw outside(expected);
  let real;
  try {
    real = fs.realpathSync(expected);
  } catch {
    throw Object.assign(
      new Error(`Discovery fixture does not exist: ${expected} (expected inside PLUGIN_DATA ${dataReal})`),
      { code: 'fixture_not_found', details: { fixture: requested, expected, dataDir: dataReal } }
    );
  }
  if (!inside(real)) throw outside(real);
  if (!fs.statSync(real).isFile()) {
    throw Object.assign(
      new Error(`Discovery fixture must be a regular file: ${expected} (expected inside PLUGIN_DATA ${dataReal})`),
      { code: 'fixture_read_error', details: { fixture: requested, expected, dataDir: dataReal } }
    );
  }
  return { dataDir: dataReal, absolute: real, relative: path.relative(dataReal, real) };
}

/**
 * Ensure a discovery fixture path resolves inside the host PLUGIN_DATA
 * directory (B16 arbitrary-path boundary). Returns the real absolute path.
 */
export function resolveDiscoveryFixture(fixture, dataDir) {
  return resolveDiscoveryFixturePath(fixture, dataDir).absolute;
}

/**
 * Fetch and normalize jobs from an offline Greenhouse board fixture
 * (JobOS adapters.js greenhouse.fetchJobs + normalizedJob). Reads JSON only
 * from the PLUGIN_DATA-staged fixture path; no network, no API keys.
 */
export function fetchGreenhouseOffline(config = {}, { dataDir, nowMs = Date.now() } = {}) {
  if (!config.fixture && !config.boardToken) {
    throw Object.assign(
      new Error('Greenhouse offline search requires a fixture path (inside PLUGIN_DATA) or boardToken.'),
      { code: 'offline_adapter_requires_fixture' }
    );
  }
  const fixtureAbs = resolveDiscoveryFixture(config.fixture, dataDir);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(fixtureAbs, 'utf8'));
  } catch (error) {
    throw Object.assign(new Error(`Cannot read discovery fixture: ${error.message}`), { code: 'fixture_read_error' });
  }
  return normalizeGreenhouseBoard(data, config, nowMs);
}

function normalizeGreenhouseBoard(data, config = {}, nowMs = Date.now()) {
  const rows = Array.isArray(data?.jobs) ? data.jobs : [];
  const company = greenhouseCompany(config);
  return {
    company,
    jobs: rows.map(row => {
      const location = String(row.location?.name || row.location || '');
      const description = stripHtml(row.content || row.description || '');
      const compensationText = metadataValue(row.metadata, ['salary', 'compensation', 'salary range', 'pay range', 'salary_range']);
      const workModelValue = row.workplace_type || row.work_model || metadataValue(row.metadata, ['workplace type', 'work model', 'remote']);
      const employmentTypeValue = row.employment_type || metadataValue(row.metadata, ['employment type', 'commitment']);
      const department = [row.departments, row.department, metadataValue(row.metadata, ['department', 'team'])]
        .flatMap(value => Array.isArray(value) ? value.filter(Boolean).map(item => String(item.name || item)) : value ? [value] : [])
        .map(String).filter(Boolean).join(' / ');
      const rowCompany = greenhouseCompany({ ...config, companyLabel: config.companyLabel || company });
      const hint = { kind: 'listed_in_public_ats', observedAt: isoFromEpochMs(nowMs),
        request: { requestedUrl: String(row.absolute_url || row.url || ''), finalUrl: String(row.absolute_url || row.url || ''), httpStatus: 200 } };
      return {
        title: String(row.title || '').trim() || 'Imported role', company: rowCompany, location,
        url: String(row.absolute_url || row.url || ''), source: 'greenhouse', sourceId: String(row.id || ''), description,
        postedDate: String(row.updated_at || row.first_published || row.created_at || ''),
        compensation: parseCompensationText(compensationText || metadataValue(row.metadata, ['salary_range'])),
        workModel: workModelFromLocation(workModelValue ? String(workModelValue.name || workModelValue) : location, description),
        employmentTypes: (() => { const type = employmentTypeFrom(employmentTypeValue ? String(employmentTypeValue.name || employmentTypeValue) : ''); return type ? [type] : []; })(),
        department, livenessHint: hint,
      };
    }),
  };
}

export async function fetchGreenhousePublic(config = {}, options = {}) {
  const token = String(config.boardToken || config.board_token || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(token)) {
    throw Object.assign(new Error('A valid Greenhouse boardToken is required for public discovery.'), { code: 'invalid_board_token' });
  }
  const endpoint = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`;
  const resource = await fetchPublicResource(endpoint, { maxBytes: 10 * 1024 * 1024, ...options });
  let data;
  try { data = JSON.parse(resource.text); }
  catch { throw Object.assign(new Error('Public Greenhouse board returned invalid JSON.'), { code: 'ats_invalid_response' }); }
  return normalizeGreenhouseBoard(data, config, Date.now());
}

export async function fetchSavedSearchSource(search, { dataDir, fetchImpl = globalThis.fetch, lookupImpl = dns.lookup } = {}) {
  if (search.adapter !== 'greenhouse') throw Object.assign(new Error(`No public ATS adapter for: ${search.adapter}`), { code: 'unsupported_adapter' });
  return search.config?.fixture
    ? fetchGreenhouseOffline(search.config, { dataDir })
    : fetchGreenhousePublic(search.config, { fetchImpl, lookupImpl });
}

// ---------------------------------------------------------------------------
// Saved searches (B19) — store-object helpers; persisted by the parent domain.
// ---------------------------------------------------------------------------

export function savedSearchIdentity(adapter, config = {}) {
  return `${String(adapter || '').toLowerCase()}:${JSON.stringify({
    company: String(config.company || config.companyLabel || '').toLowerCase().trim(),
    boardToken: String(config.boardToken || config.board_token || '').toLowerCase().trim(),
    fixture: String(config.fixture || '').trim(),
    minFit: Number.isFinite(Number(config.minFit)) ? Number(config.minFit) : null,
  })}`;
}

/**
 * Create or return the equivalent saved search for a profile. Pure store
 * mutation (no files) EXCEPT that a staged offline `config.fixture` is
 * resolved and validated against PLUGIN_DATA (rc5): a PLUGIN_DATA-relative
 * fixture is stored as its resolved PLUGIN_DATA path, and a fixture that
 * escapes PLUGIN_DATA or does not exist is rejected here — with a typed
 * error naming the expected location — instead of failing at run time
 * against the server process cwd. Returns { search, created, deduped }.
 */
export function createSavedSearch(store, { profileId, name, adapter, config = {}, minFit = 70, at, dataDir = null }) {
  if (!profileId) throw Object.assign(new Error('create_saved_search requires profileId'), { code: 'missing_profile' });
  if (!name) throw Object.assign(new Error('create_saved_search requires name'), { code: 'missing_search_name' });
  const kind = String(adapter || '').toLowerCase();
  if (!OFFLINE_ADAPTERS.includes(kind)) {
    throw Object.assign(new Error(`Unsupported offline adapter: ${adapter}`), { code: 'unsupported_adapter', details: { allowed: OFFLINE_ADAPTERS } });
  }
  if (!store.profiles || !store.profiles[profileId]) {
    throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  }
  // Validate before any mutation so a rejected search is never persisted.
  // Without a dataDir (pure store-level callers) the fixture is stored as
  // given; the run path still resolves it against PLUGIN_DATA.
  let savedConfig = config && typeof config === 'object' ? config : {};
  let identityConfig = savedConfig;
  if (String(savedConfig.fixture ?? '').trim() && dataDir) {
    const resolved = resolveDiscoveryFixturePath(savedConfig.fixture, dataDir);
    savedConfig = { ...savedConfig, fixture: resolved.absolute };
    // Identity keeps the PLUGIN_DATA-relative form, so a search created with a
    // relative fixture and the same search created with its absolute path (or
    // a legacy stored entry) remain the same saved search.
    identityConfig = { ...savedConfig, fixture: resolved.relative };
  }
  store.searches = store.searches || {};
  const searches = Object.values(store.searches).filter(search => search.profileId === profileId);
  const identity = savedSearchIdentity(kind, identityConfig);
  const existing = searches.find(search => search.adapter === kind && search.identity === identity);
  if (existing) return { search: existing, created: false, deduped: true };
  const searchId = id('search', `${profileId}:${name}`);
  const safeMinFit = Number.isFinite(Number(minFit)) ? Number(minFit) : 70;
  const search = {
    id: searchId,
    name,
    profileId,
    adapter: kind,
    config: savedConfig,
    identity,
    minFit: safeMinFit,
    createdAt: at || now(),
    updatedAt: at || now(),
  };
  store.searches[searchId] = search;
  return { search, created: true, deduped: false };
}

export function getSavedSearch(store, ref) {
  const searches = store.searches || {};
  if (searches[ref]) return searches[ref];
  return Object.values(searches).find(search => search.name === ref || search.id === ref) || null;
}

export function listSavedSearches(store, { profileId = null } = {}) {
  const searches = Object.values(store.searches || {});
  return profileId ? searches.filter(search => search.profileId === profileId).sort((a, b) => String(a.name).localeCompare(String(b.name))) : searches;
}

// ---------------------------------------------------------------------------
// Discovery run execution (B19/B20) — port of JobOS runSavedSearch() outputs.
// ---------------------------------------------------------------------------

export function deriveDiscoveryStatus({ counts = {}, errors = [] } = {}) {
  const durableProgress = Number(counts.imported || 0) + Number(counts.deduped || 0) + Number(counts.scored || 0) + Number(counts.expired || 0);
  const incomplete = errors.length > 0;
  if (incomplete && durableProgress > 0) return 'partial';
  if (incomplete) return 'failed';
  return 'succeeded';
}

function emptyRunCounts() {
  return { fetched: 0, processed: 0, imported: 0, deduped: 0, scored: 0, highFit: 0, active: 0, expired: 0, uncertain: 0, failed: 0 };
}

/**
 * Execute one saved search against the store object in memory. Mutates
 * store.jobs only (database-only: no files or folders). Returns the standard
 * discovery run outputs; the parent persists the store via the serialized
 * commit path and exposes the tool.
 */
export function runSavedSearch(store, { searchRef, profileId, dataDir, sourceResult = null, sourceError = null, now: nowFn = now } = {}) {
  const search = getSavedSearch(store, searchRef);
  if (!search) throw Object.assign(new Error(`Unknown saved search: ${searchRef}`), { code: 'unknown_saved_search' });
  if (profileId && search.profileId !== profileId) {
    throw Object.assign(new Error(`Saved search ${search.id} belongs to profile ${search.profileId}, not ${profileId}`), { code: 'profile_mismatch' });
  }
  const runId = id('run', `discover:${search.id}:${nowFn()}`);
  const createdAt = nowFn();
  const outputs = {
    version: DISCOVERY_OUTPUTS_VERSION,
    runId,
    searchId: search.id,
    searchName: search.name,
    profileId: search.profileId,
    adapter: search.adapter,
    config: search.config,
    status: 'succeeded',
    counts: emptyRunCounts(),
    jobs: [],
    errors: [],
    metadata: {},
    createdAt,
    finishedAt: null,
  };
  try {
    let result;
    if (sourceError) {
      // The caller already attempted this search's source and it failed
      // (daily_discovery fault isolation): report the original typed failure
      // as this search's fetch error instead of re-fetching or aborting.
      throw Object.assign(new Error(sourceError?.message || String(sourceError)), {
        code: sourceError?.code || sourceError?.name || 'discovery_error',
        details: sourceError?.details,
      });
    }
    if (search.adapter === 'greenhouse') {
      result = sourceResult || fetchGreenhouseOffline(search.config, { dataDir });
    } else {
      throw Object.assign(new Error(`No offline adapter for: ${search.adapter}`), { code: 'unsupported_adapter' });
    }
    const jobs = Array.isArray(result) ? result : result?.jobs;
    if (!Array.isArray(jobs)) throw new Error(`Discovery adapter ${search.adapter} returned an invalid result`);
    outputs.counts.fetched = jobs.length;
    outputs.metadata.company = result?.company || '';
    for (const row of jobs) {
      outputs.counts.processed += 1;
      try {
        const liveness = classifyLiveness(row, { now: () => createdAt });
        const imported = importDiscoveredJob(store, {
          profileId: search.profileId,
          job: { ...row, liveness },
          source: row.source || search.adapter,
          sourceId: row.sourceId,
          runId,
          at: createdAt,
        });
        if (liveness.status === 'active') outputs.counts.active += 1;
        else if (liveness.status === 'uncertain') outputs.counts.uncertain += 1;
        if (imported.created) outputs.counts.imported += 1;
        else outputs.counts.deduped += 1;
        outputs.jobs.push({
          id: imported.job.id,
          jobId: imported.job.id,
          title: imported.job.title,
          company: imported.job.company,
          sourceId: row.sourceId || '',
          url: imported.job.url,
          outcome: imported.created ? 'discovered' : 'deduped',
          created: imported.created,
          deduped: !imported.created,
          score: null,
          highFit: false,
          liveness,
          fit: null,
          postingLiveness: postingLivenessHandoff(liveness),
          error: null,
        });
      } catch (error) {
        outputs.counts.failed += 1;
        outputs.errors.push({
          stage: 'import',
          message: error?.message || String(error),
          code: error?.code || error?.name || 'discovery_error',
          url: String(row?.url || ''),
        });
      }
    }
    search.lastRunAt = createdAt;
    search.updatedAt = createdAt;
  } catch (error) {
    outputs.counts.failed += 1;
    outputs.errors.push({
      stage: 'fetch',
      message: error?.message || String(error),
      code: error?.code || error?.name || 'discovery_error',
      url: String(error?.details?.fixture || search.config?.fixture || ''),
    });
  }
  outputs.status = deriveDiscoveryStatus({ counts: outputs.counts, errors: outputs.errors });
  outputs.finishedAt = nowFn();
  outputs.message = 'Discovered jobs are database-only until explicitly saved or pursued. No application folder or external action was created.';
  return outputs;
}

export function runAllSearches(store, { profileId, dataDir, sourceResults = {}, sourceErrors = {}, now: nowFn = now } = {}) {
  if (!profileId) throw Object.assign(new Error('daily_discovery requires profileId'), { code: 'missing_profile' });
  if (!store.profiles || !store.profiles[profileId]) {
    throw Object.assign(new Error(`Unknown profile: ${profileId}`), { code: 'unknown_profile' });
  }
  const searches = listSavedSearches(store, { profileId });
  const runs = searches.map(search => runSavedSearch(store, {
    searchRef: search.id, profileId, dataDir,
    sourceResult: sourceResults[search.id] || null,
    sourceError: sourceErrors[search.id] || null,
    now: nowFn,
  }));
  const counts = emptyRunCounts();
  const jobs = [];
  const errors = [];
  for (const run of runs) {
    for (const key of Object.keys(counts)) counts[key] += run.counts[key] || 0;
    jobs.push(...run.jobs);
    errors.push(...run.errors.map(error => ({ ...error, searchId: run.searchId, searchName: run.searchName })));
  }
  return {
    version: DISCOVERY_OUTPUTS_VERSION,
    profileId,
    runs,
    jobs,
    results: jobs,
    items: jobs,
    counts,
    errors,
    status: deriveDiscoveryStatus({ counts, errors }),
    createdAt: nowFn(),
    finishedAt: nowFn(),
    message: 'Daily discovery completed. Discovered jobs remain database-only until explicitly saved or pursued; no folder or external action was created.',
  };
}

// ---------------------------------------------------------------------------
// P1b Greenhouse per-job application detail (Greenhouse ONLY).
// Same trust level as the existing public board fetch: public
// boards-api.greenhouse.io JSON, no auth/keys/login. No other ATS, no
// crawlers, no browser automation (host fetches; plugin parses).
// ---------------------------------------------------------------------------

export const GREENHOUSE_DETAIL_FIXTURE_NAME = 'greenhouse-detail-fixture.json';

/**
 * Parse a Greenhouse board/job reference from a job URL or posting text.
 * Accepts boards.greenhouse.io and boards-api.greenhouse.io URLs.
 * Returns { board, id } or null when the job is not a Greenhouse job.
 */
export function parseGreenhouseRef(job = {}, postingText = '') {
  const haystack = [
    job && job.detailUrl,
    job && job.greenhouseDetailUrl,
    job && job.greenhouseUrl,
    job && job.url,
    postingText,
  ].filter(value => value != null && String(value).trim() !== '').map(String).join('\n');
  if (!haystack) return null;
  let match = haystack.match(/boards-api\.greenhouse\.io\/v1\/boards\/([A-Za-z0-9_-]+)\/jobs\/(\d+)/i);
  if (match) return { board: match[1], id: match[2] };
  match = haystack.match(/boards\.greenhouse\.io\/([A-Za-z0-9_-]+)\/jobs\/(\d+)/i);
  if (match) return { board: match[1], id: match[2] };
  return null;
}

/** Build the public per-job Greenhouse detail URL (`?questions=true`). */
export function greenhouseDetailUrl(board, jobId) {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(String(board))}/jobs/${encodeURIComponent(String(jobId))}?questions=true`;
}

const GREENHOUSE_DOC_KINDS = new Set(['resume', 'cover_letter', 'portfolio', 'other']);

function normalizeGreenhouseDocKind(raw) {
  const text = String(raw == null ? '' : raw).toLowerCase().replace(/[\s-]+/g, '_');
  if (/resume|curriculum_vitae|\bcv\b/.test(text)) return 'resume';
  if (/cover/.test(text)) return 'cover_letter';
  if (/portfolio|work_sample|writing_sample/.test(text)) return 'portfolio';
  return 'other';
}

/**
 * Normalize a raw Greenhouse `?questions=true` payload into
 * questions[] { label, required, kind, options[] } and
 * documents[] { kind: resume|cover_letter|portfolio|other, required }.
 * Live Greenhouse emits NO top-level `documents` key: attachment uploads
 * (Resume/CV, Cover Letter, …) arrive as question rows with file-ish
 * types (input_file/attachment) or document-like labels. Documents are
 * therefore DERIVED from the question rows; an explicit vendor
 * `documents[]` is only merged when present (back-compat, deduped by
 * kind with required OR-ed). The raw payload itself is never mutated;
 * preserve it verbatim separately.
 */
export function normalizeGreenhouseDetail(raw) {
  const detail = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const rows = Array.isArray(detail.questions) ? detail.questions : [];
  const questions = [];
  const documents = [];
  const seenDoc = new Map();
  const noteDoc = (kind, required) => {
    const prior = seenDoc.get(kind);
    if (prior === undefined) {
      seenDoc.set(kind, Boolean(required));
      documents.push({ kind, required: Boolean(required) });
    } else if (required && !prior) {
      seenDoc.set(kind, true);
      const entry = documents.find(item => item.kind === kind);
      if (entry) entry.required = true;
    }
  };
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const label = String(row.label ?? row.name ?? row.title ?? '').trim();
    if (!label) continue;
    // Live Greenhouse nests field types/values: fields: [{ type, values: [{ label }] }].
    // Derive kind/options from the nested fields; fall back to row-level only
    // when no fields are present.
    const fields = Array.isArray(row.fields) ? row.fields.filter(f => f && typeof f === 'object') : [];
    let kind;
    let options;
    if (fields.length > 0) {
      const fileishField = fields.find(f => /^(input_file|attachment|upload)$/i.test(String(f.type ?? '')));
      const picked = fileishField
        ?? fields.find(f => String(f.type ?? '') !== 'input_hidden');
      if (picked) {
        kind = String(picked.type ?? row.kind ?? row.type ?? 'input_text') || 'input_text';
        const values = Array.isArray(picked.values) ? picked.values : [];
        options = values.map(v => {
          if (v && typeof v === 'object') return String(v.label ?? v.value ?? v.name ?? '');
          return String(v ?? '');
        }).filter(s => s !== '');
      } else {
        kind = String(row.kind ?? row.type ?? 'input_text');
        options = [];
      }
    } else {
      kind = String(row.kind ?? row.type ?? 'input_text');
      options = Array.isArray(row.options)
        ? row.options.map(String)
        : Array.isArray(row.values)
          ? row.values.map(String)
          : [];
    }
    questions.push({
      label,
      required: Boolean(row.required),
      kind,
      options,
    });
    // Derive document uploads from live question rows: file-ish field
    // types, or strong document-like labels (Resume/CV, Cover Letter,
    // portfolio/work samples, extra attachments).
    const fileish = /file|attachment|upload/i.test(kind);
    const lowered = label.toLowerCase().replace(/[\s-]+/g, '_');
    const strongLabel = /resume|curriculum_vitae|\bcv\b|cover/.test(lowered)
      || /portfolio|work_sample|writing_sample/.test(lowered)
      || (/attach/.test(lowered) && !/^(linkedin|github|personal_website|personal|website)/.test(lowered));
    if (fileish || strongLabel) {
      noteDoc(normalizeGreenhouseDocKind(label), Boolean(row.required));
    }
  }
  const docs = Array.isArray(detail.documents) ? detail.documents : [];
  for (const row of docs) {
    if (!row || typeof row !== 'object') continue;
    const kind = GREENHOUSE_DOC_KINDS.has(String(row.kind).toLowerCase())
      ? String(row.kind).toLowerCase()
      : normalizeGreenhouseDocKind(row.kind ?? row.name ?? row.label);
    noteDoc(kind, Boolean(row.required));
  }
  return { questions, documents };
}

// Greenhouse per-job payloads carry the AUTHORITATIVE listing identity:
// `title` (vendor requisition title, sometimes padded for presentation),
// `company_name`, `location.name` and a `metadata[]` row named
// "Workplace Type". Values are trimmed; a key the vendor does not state stays
// empty so callers promote only what the source actually claims.
const GREENHOUSE_WORKPLACE_METADATA = /^(?:workplace|work|location)[\s_-]*(?:type|model)|^remote[\s_-]*status$/i;

function greenhouseWorkplaceText(metadata) {
  for (const row of Array.isArray(metadata) ? metadata : []) {
    if (!row || typeof row !== 'object') continue;
    const name = String(row.name ?? row.label ?? row.key ?? '').trim();
    if (!GREENHOUSE_WORKPLACE_METADATA.test(name)) continue;
    const value = row.value ?? row.values ?? row.text ?? null;
    const text = typeof value === 'string' ? value.trim() : '';
    if (text) return text;
  }
  return '';
}

/**
 * Normalize the authoritative listing fields of a Greenhouse detail payload.
 * Never throws; a non-object payload yields empty fields.
 */
export function greenhouseListingFields(rawDetail) {
  const detail = rawDetail && typeof rawDetail === 'object' && !Array.isArray(rawDetail) ? rawDetail : {};
  const rawLocation = detail.location && typeof detail.location === 'object' ? detail.location.name : detail.location;
  return {
    title: String(detail.title ?? '').trim(),
    company: String(detail.company_name ?? '').trim(),
    location: String(rawLocation ?? '').trim(),
    workModel: workModelFromLocation(greenhouseWorkplaceText(detail.metadata), ''),
  };
}

function greenhouseDetailOk({ board, refId, raw, rawText, source }) {
  const { questions, documents } = normalizeGreenhouseDetail(raw);
  return {
    ok: true,
    status: 'ok',
    board,
    id: refId,
    detailUrl: greenhouseDetailUrl(board, refId),
    questions,
    documents,
    rawDetail: raw,
    listing: greenhouseListingFields(raw),
    rawText: String(rawText),
    fetchedAt: now(),
    source,
  };
}

function greenhouseDetailDegraded(ref, reason, message) {
  return {
    ok: false,
    status: 'degraded',
    board: ref ? ref.board : '',
    id: ref ? ref.id : '',
    detailUrl: ref ? greenhouseDetailUrl(ref.board, ref.id) : '',
    questions: [],
    documents: [],
    rawDetail: null,
    reason: String(reason || 'detail_fetch_failed'),
    ...(message ? { message: String(message) } : {}),
    fetchedAt: now(),
    source: 'none',
  };
}

/**
 * Synchronously read a staged Greenhouse detail fixture from inside
 * PLUGIN_DATA (same trust model as offline board fixtures). Returns the
 * parsed raw payload, or null when absent/unreadable. Never throws, never
 * touches the network. `fixtureName` must be a bare file name confined to
 * the data dir.
 */
export function readGreenhouseDetailFixture(dataDir, fixtureName = GREENHOUSE_DETAIL_FIXTURE_NAME) {
  try {
    const name = String(fixtureName || '').trim() || GREENHOUSE_DETAIL_FIXTURE_NAME;
    if (name.includes('/') || name.includes('\\') || name !== path.basename(name)) return null;
    const dir = ensureDataDir(dataDir);
    const abs = path.join(dir, name);
    let real;
    try { real = fs.realpathSync(abs); } catch { return null; }
    const dataReal = fs.realpathSync(dir);
    if (real !== dataReal && !real.startsWith(`${dataReal}${path.sep}`)) return null;
    const rawText = fs.readFileSync(abs, 'utf8');
    return { raw: JSON.parse(rawText), rawText };
  } catch {
    return null;
  }
}

/**
 * Fetch and normalize the Greenhouse per-job application detail.
 * Greenhouse-only. Resolution order: staged PLUGIN_DATA fixture (no
 * network) → public boards-api URL via fetchPublicResource (accepts
 * fetchImpl for tests). Missing fixture or failed fetch returns a degraded
 * result; never throws.
 */
export async function fetchApplicationDetail(job = {}, { dataDir = null, fetchImpl = globalThis.fetch, lookupImpl = dns.lookup, postingText = '', fixtureName = null } = {}) {
  const ref = parseGreenhouseRef(job, postingText);
  if (!ref) return greenhouseDetailDegraded(null, 'not_a_greenhouse_job');
  if (dataDir) {
    const staged = readGreenhouseDetailFixture(dataDir, fixtureName || GREENHOUSE_DETAIL_FIXTURE_NAME);
    if (staged) return greenhouseDetailOk({ board: ref.board, refId: ref.id, raw: staged.raw, rawText: staged.rawText, source: 'fixture' });
  }
  try {
    const url = greenhouseDetailUrl(ref.board, ref.id);
    const resource = await fetchPublicResource(url, { fetchImpl, lookupImpl, maxBytes: 2 * 1024 * 1024 });
    let raw;
    try { raw = JSON.parse(resource.text); }
    catch { return greenhouseDetailDegraded(ref, 'ats_invalid_response', 'Public Greenhouse job returned invalid JSON.'); }
    return greenhouseDetailOk({ board: ref.board, refId: ref.id, raw, rawText: resource.text, source: 'public_api' });
  } catch (cause) {
    return greenhouseDetailDegraded(ref, (cause && cause.code) || 'detail_fetch_failed', cause && cause.message);
  }
}

/**
 * Synchronous variant used on the import/pursue path (which must stay
 * synchronous for in-process callers): staged fixture or inline detail
 * only, never network. Returns { ok, ...detail } or a degraded result.
 */
export function resolveGreenhouseDetailSync(job = {}, { dataDir = null, postingText = '', inlineDetail = null, fixtureName = null } = {}) {
  const ref = parseGreenhouseRef(job, postingText);
  if (inlineDetail && typeof inlineDetail === 'object') {
    const board = String(inlineDetail.board || (ref && ref.board) || '').trim();
    const refId = String(inlineDetail.id || (ref && ref.id) || '').trim();
    if (board && refId) {
      return greenhouseDetailOk({ board, refId, raw: inlineDetail, rawText: JSON.stringify(inlineDetail), source: 'inline' });
    }
  }
  if (dataDir && ref) {
    const staged = readGreenhouseDetailFixture(dataDir, fixtureName || GREENHOUSE_DETAIL_FIXTURE_NAME);
    if (staged) return greenhouseDetailOk({ board: ref.board, refId: ref.id, raw: staged.raw, rawText: staged.rawText, source: 'fixture' });
    return greenhouseDetailDegraded(ref, 'detail_fetch_failed', 'No staged Greenhouse detail fixture; live fetch is not performed on the sync import path.');
  }
  if (ref) return greenhouseDetailDegraded(ref, 'detail_fetch_failed', 'Greenhouse detail is unavailable.');
  return greenhouseDetailDegraded(null, 'not_a_greenhouse_job');
}
