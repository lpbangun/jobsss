// Shared salary parsing for intake and native fit. Never combine base with
// discretionary compensation or invent currency conversions/annualization.

// Split pay text into clauses: isolate the sentence that carries the salary
// mention (a period followed by a space never occurs inside the supported
// amount shapes), then split that sentence at `;`. Trailing post-base terms
// (bonus/equity/total compensation/OTE) are cut inside the mention clause
// itself, except when such a term is the clause's own label.
function sentenceClauses(text, mentionAt) {
  const sentence = mentionAt >= 0
    ? String(text).slice(0, mentionAt).split(/(?<=\.)\s+/).pop() + String(text).slice(mentionAt)
    : String(text);
  return sentence.split(/;\s*/);
}

export function parseCompensation(value) {
  const structured = value && typeof value === 'object' ? value : {};
  const nested = structured.value && typeof structured.value === 'object' ? structured.value : structured;
  const raw = typeof value === 'string' ? value : String(structured.text || '');
  const lines = raw.split(/\r?\n/);
  // Prefer an explicit base-salary line, then any salary-labeled line: a
  // plain "Salary: undisclosed" must never shadow a later
  // "Base salary: USD 135,000-150,000." line.
  const labelRe = /(?:base (?:salary|pay)|(?:salary|compensation|pay range|salary range)\s*:)/i;
  const labeledLine = lines.find(line => /base (?:salary|pay)\s*:/i.test(line)) || lines.find(line => labelRe.test(line));
  const text = (labeledLine || raw).trim();
  // Anchor the pay segment at the salary mention so that on flattened
  // one-line postings an unrelated "N-M" clause (years of experience, per
  // diem, "3-6 years") is never read as compensation. Parsing stays within
  // the sentence (and clause) that contains the mention; a currency amount
  // written directly before the mention ("USD 130,000 annual guaranteed
  // base salary") is attached only when the mention clause lacks amounts.
  const mentionAt = text.search(/\b(?:salary|compensation|pay range|salary range|base pay)\b/i);
  const clauses = sentenceClauses(text, mentionAt);
  const mentionClause = clauses.find(clause => mentionAt < 0 || /\b(?:salary|compensation|pay range|salary range|base pay)\b/i.test(clause));
  let baseText = String(mentionClause || text).trim();
  if (mentionAt >= 0) {
    // Cut trailing post-base terms (bonus, equity, OTE, "total compensation")
    // inside the mention's own clause, unless such a term is the clause's
    // own label ("Total compensation: USD 160,000 including equity").
    const mentionAtInClause = baseText.search(/\b(?:salary|compensation|pay range|salary range|base pay)\b/i);
    const cut = baseText.slice(mentionAtInClause).search(/\b(?:bonus|equity|discretionary|total compensation|OTE)\b/i);
    if (cut > 0) baseText = baseText.slice(0, mentionAtInClause + cut);
  }
  const amountPattern = /(?:USD|GBP|EUR|CAD|AUD|NZD|CHF|JPY|[$£€])\s*[\d\s,.kK]+/i;
  if (mentionAt >= 0 && !amountPattern.test(baseText)) {
    const index = clauses.indexOf(mentionClause);
    const prior = index > 0 ? String(clauses[index - 1]).trim() : '';
    if (amountPattern.test(prior)) baseText = `${prior} ${baseText}`;
  }
  const currencyMatch = baseText.match(/\b(USD|GBP|EUR|CAD|AUD|NZD|CHF|JPY)\b/i);
  const currency = String(structured.currency || currencyMatch?.[1] || (/£/.test(baseText) ? 'GBP' : /€/.test(baseText) ? 'EUR' : /\$/.test(baseText) ? 'USD' : '')).toUpperCase();
  const amount = '(?:[\\d]{1,3}(?:,[\\d]{3})+|[\\d]+)(?:\\.[\\d]+)?\\s*[kK]?';
  const optionalPrefix = '(?:(?:USD|GBP|EUR|CAD|AUD|NZD|CHF|JPY)\\s*|[$£€]\\s*)?';
  const requiredPrefix = '(?:(?:USD|GBP|EUR|CAD|AUD|NZD|CHF|JPY)\\s*|[$£€]\\s*)';
  const labeled = labelRe.test(text);
  // Labeled pay segments may carry bare amounts ("Base salary: 80,000-95,000");
  // unlabeled text must show a currency on at least one side of the range so
  // a bare "3-5 years" is never a salary ("USD 80–95k", "$130,000-150,000").
  const range = baseText.match(new RegExp(`${labeled ? optionalPrefix : requiredPrefix}(${amount})\\s*(?:[-–—]|to)\\s*${optionalPrefix}(${amount})`, 'i'))
    || (!labeled && text.match(new RegExp(`(${amount})\\s*(?:[-–—]|to)\\s*${requiredPrefix}(${amount})`, 'i')));
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
