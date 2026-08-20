export interface ImportLineData {
  [key: string]: string;
}

const HEADER_FIELD_MAP: Record<string, string> = {
  'num_adm': 'contractNumber',
  'cliente': 'debtorName',
  'nome_cliente': 'debtorName',
  'documento': 'debtorDocument',
  'mes_contrato': 'occurrenceDate',
  // Layout used by the production portfolio export.  Despite its name, the
  // value is the contract/occurrence date in YYYYMMDD format.
  'm_contrato': 'occurrenceDate',
  'vlr': 'originalValue',
  'valor_divida': 'originalValue',
  'telefone': 'debtorPhone',
  'telefone_cliente': 'debtorPhone',
  'email': 'debtorEmail',
  'rua': 'debtorStreet',
  'endereco': 'debtorStreet',
  'cidade': 'debtorCity',
};

/**
 * Some creditor exports contain a single current balance column.  It is both
 * the imported face value and the value currently payable, so retain it in
 * updatedValue as well.  This also makes the contract eligible for Pix
 * issuance without a manual edit after import.
 */
const DUPLICATE_HEADER_FIELD_MAP: Record<string, string> = {
  'valor_divida': 'updatedValue',
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
    const normalizedHeader = header.trim().toLowerCase();
    const targetField = HEADER_FIELD_MAP[normalizedHeader];
    if (targetField && !normalized[targetField]) normalized[targetField] = header;

    const duplicateTargetField = DUPLICATE_HEADER_FIELD_MAP[normalizedHeader];
    if (duplicateTargetField && !normalized[duplicateTargetField]) {
      normalized[duplicateTargetField] = header;
    }
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
