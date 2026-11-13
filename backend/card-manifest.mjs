/**
 * Private PHAM card production manifest.
 * Every spreadsheet cell is quoted and guarded against CSV formula execution.
 * Does not include email, shipping address or other Shopify customer identifiers.
 */
export function safeCsvCell(raw) {
  let text = raw == null ? '' : String(raw);
  // Printable notes must never be interpreted as spreadsheet formulas on import.
  if (/^[\s]*[=+\-@]/u.test(text) || /^[\t\r]/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function buildCardManifestCsv(items = []) {
  if (!Array.isArray(items) || items.length > 50) throw new Error('invalid_manifest_size');
  const fields = [
    ['reservation_id','Reservation ID'],
    ['reservation_status','Reservation status'],
    ['size_preference','Jacket size'],
    ['object_number','Held object number'],
    ['preferred_number','Preferred card number'],
    ['engraving_name','Name to print'],
    ['engraving_text','Card inscription'],
    ['production_notes','Private production instructions'],
    ['configured_at','Request timestamp'],
  ];
  const lines = [fields.map(([,title])=>safeCsvCell(title)).join(',')];
  const seen = new Set();
  for(const item of items) {
    if(!item || !item.reservation_id || seen.has(item.reservation_id)) throw new Error('duplicate_or_missing_reservation');
    seen.add(item.reservation_id);
    lines.push(fields.map(([key])=>safeCsvCell(item[key])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
