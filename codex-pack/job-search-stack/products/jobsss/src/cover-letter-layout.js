// Conventional word-processor letter layout shared by editable and PDF exports.
export const COVER_LETTER_LAYOUT = Object.freeze({
  fontFamily: 'Times New Roman', fontSize: 11, contactFontSize: 10.5,
  margin: 72, lineSpacing: 1.15, paragraphAfter: 8, blockAfter: 12,
  signatureBefore: 12,
});

/** Classify existing text for spacing only; never add or rewrite applicant facts. */
export function classifyCoverLetterBlocks(content) {
  const groups = String(content ?? '').replace(/\r\n?/g, '\n').trim().split(/\n[\t ]*\n+/).filter(Boolean);
  const blocks = [];
  let inBody = false;
  let inSignature = false;
  for (let index = 0; index < groups.length; index += 1) {
    const text = groups[index].trim();
    const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    if (/^(?:Dear|Hello|To the)\b/i.test(lines[0]) && /[,!:]$/.test(lines[0])) {
      blocks.push({ type: 'salutation', text: lines[0] });
      if (lines.length > 1) blocks.push({ type: 'paragraph', text: lines.slice(1).join('\n') });
      inBody = true;
      continue;
    }
    if (inBody && /^(?:Sincerely|Yours sincerely|Yours truly|Best regards|Kind regards|Regards|Thank you(?: for your consideration)?)[,!]?$/i.test(lines[0])) {
      blocks.push({ type: 'closing', text: lines[0] });
      if (lines.length > 1) blocks.push({ type: 'signature', text: lines.slice(1).join('\n') });
      inSignature = true;
      continue;
    }
    if (inSignature) { blocks.push({ type: 'signature', text: lines.join('\n') }); continue; }
    if (!inBody) {
      const date = /^(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})$/i.test(text);
      const contact = index === 0 && /@|https?:\/\/|www\.|linkedin\.com|\b(?:email|phone):|\+?\d[\d ()-]{7,}/i.test(text);
      const beforeSalutation = groups.slice(index + 1).some(group => /^(?:Dear|Hello|To the)\b/i.test(group.trim()));
      if (date || contact || beforeSalutation) {
        blocks.push({ type: date ? 'date' : contact ? 'contact' : 'recipient', text: lines.join('\n') });
        continue;
      }
      inBody = true;
    }
    blocks.push({ type: 'paragraph', text: lines.join('\n') });
  }
  return blocks;
}
