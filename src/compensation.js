// Shared salary parsing for intake and native fit. Never combine base with
// discretionary compensation or invent currency conversions/annualization.
export function parseCompensation(value) {
  const structured = value && typeof value === 'object' ? value : {};
  const nested = structured.value && typeof structured.value === 'object' ? structured.value : structured;
  const raw = typeof value === 'string' ? value : String(structured.text || '');
  const lines = raw.split(/\r?\n/);
  const text = (lines.find(line => /(?:base (?:salary|pay)|(?:salary|compensation|pay range)\s*:)/i.test(line)) || raw).trim();
  const baseText = text.split(/;|\b(?:bonus|equity|discretionary|total compensation|OTE)\b/i)[0];
  const currencyMatch = baseText.match(/\b(USD|GBP|EUR|CAD|AUD|NZD|CHF|JPY)\b/i);
  const currency = String(structured.currency || currencyMatch?.[1] || (/£/.test(baseText) ? 'GBP' : /€/.test(baseText) ? 'EUR' : /\$/.test(baseText) ? 'USD' : '')).toUpperCase();
  const amount = '(?:[\\d]{1,3}(?:,[\\d]{3})+|[\\d]+)(?:\\.[\\d]+)?\\s*[kK]?';
  const prefix = '(?:(?:USD|GBP|EUR|CAD|AUD|NZD|CHF|JPY)\\s*|[$£€]\\s*)?';
  const range = baseText.match(new RegExp(`${prefix}(${amount})\\s*(?:[-–—]|to)\\s*${prefix}(${amount})`, 'i'));
  const single = !range && baseText.match(new RegExp(`(?:USD|GBP|EUR|CAD|AUD|NZD|CHF|JPY|[$£€])\\s*(${amount})`, 'i'));
  const number = value => value == null || value === '' ? null : Number(String(value).replace(/[,\s]/g, '').replace(/[kK]$/, '')) * (/[kK]\s*$/.test(String(value)) ? 1000 : 1);
  let min = number(nested.min ?? nested.minValue), max = number(nested.max ?? nested.maxValue);
  if (min === null && max === null && range) {
    min = number(range[1]); max = number(range[2]);
    if (/[kK]/.test(range[2]) && !/[kK]/.test(range[1]) && min < 1000) min *= 1000;
  } else if (min === null && max === null && single) {
    if (/\b(?:up to|maximum|max)\b/i.test(baseText)) max = number(single[1]);
    else if (/\b(?:from|minimum|min|at least)\b/i.test(baseText)) min = number(single[1]);
    else min = max = number(single[1]);
  }
  if (min !== null && max !== null && min > max) { min = null; max = null; }
  const unit = String(nested.unitText || structured.interval || '').toLowerCase();
  const interval = /hour|\/hr\b/i.test(baseText + unit) ? 'hour' : /month/i.test(baseText + unit) ? 'month'
    : /week/i.test(baseText + unit) ? 'week' : /annual|year|\/yr\b|salary/i.test(baseText + unit) ? 'year' : 'unknown';
  const baseStatus = /total compensation|OTE/i.test(text) && !/base/i.test(text) ? 'unknown' : /bonus|equity/i.test(text) && !/base|salary/i.test(text) ? 'unknown' : 'stated';
  return { text, min, max, currency, interval, baseStatus };
}
