import { Medicine } from '../types';

/** Display string for medicine pickers (purchase invoice, product demands, etc.). */
export function getMedicinePickerLabel(option: Medicine): string {
  const productId = option.productId ? ` [${option.productId}]` : '';
  const code = option.code ? ` (HSN ${option.code})` : '';
  const manufacturer = option.manufacturer ? ` - ${option.manufacturer}` : '';
  return `${option.name}${productId}${code}${manufacturer}`;
}

/** Pack size from the medicine master (`unit`, or a Packaging line in the description). */
export function getMedicinePackaging(
  option: Pick<Medicine, 'unit' | 'description'> | null | undefined
): string {
  if (!option) return '';
  const unit = option.unit?.trim();
  if (unit) return unit;
  const match = option.description?.match(/Packaging:\s*(.+)/i);
  return match?.[1]?.trim().split(/\r?\n/)[0]?.trim() || '';
}
