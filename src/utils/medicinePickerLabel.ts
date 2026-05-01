import { Medicine } from '../types';

/** Display string for medicine pickers (purchase invoice, product demands, etc.). */
export function getMedicinePickerLabel(option: Medicine): string {
  const code = option.code ? ` (HSN ${option.code})` : '';
  const manufacturer = option.manufacturer ? ` - ${option.manufacturer}` : '';
  return `${option.name}${code}${manufacturer}`;
}
