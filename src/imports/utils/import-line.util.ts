export interface ImportLineData {
  [key: string]: string;
}

const HEADER_FIELD_MAP: Record<string, string> = {
  'num_adm': 'contractNumber',
  'cliente': 'debtorName',
  'documento': 'debtorDocument',
  'mes_contrato': 'occurrenceDate',
  'vlr': 'originalValue',
  'telefone': 'debtorPhone',
  'email': 'debtorEmail',
  'rua': 'debtorStreet',
  'cidade': 'debtorCity',
};

export function normalizeColumnMapping(
  columnMapping: Record<string, string>,
  headers: string[],
): Record<string, string> {
  const normalized: Record<string, string> = {};

  for (const [key, value] of Object.entries(columnMapping)) {
    const keyIsHeader = headers.some((header) => header.trim().toLowerCase() === key.trim().toLowerCase());
    const valueIsHeader = headers.some((header) => header.trim().toLowerCase() === value.trim().toLowerCase());
    if (keyIsHeader && !valueIsHeader) normalized[value] = key;
    else normalized[key] = value;
  }

  for (const header of headers) {
    const targetField = HEADER_FIELD_MAP[header.trim().toLowerCase()];
    if (targetField && !normalized[targetField]) normalized[targetField] = header;
  }

  return normalized;
}

export function normalizeImportLine(line: ImportLineData): ImportLineData {
  const normalized = { ...line };
  const date = normalized.occurrenceDate?.trim();
  if (date && /^\d{8}$/.test(date)) {
    normalized.occurrenceDate = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  }
  if (!normalized.debtType?.trim()) normalized.debtType = 'OTHER';
  return normalized;
}
