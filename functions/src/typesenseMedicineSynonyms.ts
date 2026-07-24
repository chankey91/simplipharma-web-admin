/**
 * Pharma-oriented synonym groups for Typesense `medicines` collection.
 * Synonyms improve recall for brand / spelling variants without client-side hacks.
 *
 * Synonym API: https://typesense.org/docs/latest/api/synonyms.html
 */
export type MedicineSynonymDef = {
  id: string;
  /** Root / canonical term (optional for multi-way synonyms). */
  root?: string;
  synonyms: string[];
};

/** Seed list — extend as ops discovers real misspellings from analytics. */
export const MEDICINE_SYNONYM_SEED: MedicineSynonymDef[] = [
  { id: 'pcm-paracetamol', synonyms: ['paracetamol', 'acetaminophen', 'pcm', 'crocin', 'dolo', 'calpol'] },
  { id: 'amox', synonyms: ['amoxicillin', 'amoxycillin', 'amox', 'mox'] },
  { id: 'azithro', synonyms: ['azithromycin', 'azithro', 'azee', 'zithrox'] },
  { id: 'metro', synonyms: ['metronidazole', 'metro', 'flagyl'] },
  { id: 'cipro', synonyms: ['ciprofloxacin', 'cipro', 'cifran'] },
  { id: 'omeprazole', synonyms: ['omeprazole', 'omez', 'ocid', 'prilosec'] },
  { id: 'pantoprazole', synonyms: ['pantoprazole', 'pan', 'pantocid', 'pantop'] },
  { id: 'rabeprazole', synonyms: ['rabeprazole', 'rabe', 'rabicip'] },
  { id: 'domperidone', synonyms: ['domperidone', 'domper', 'domstal'] },
  { id: 'ondansetron', synonyms: ['ondansetron', 'ondem', 'emset'] },
  { id: 'diclofenac', synonyms: ['diclofenac', 'voveran', 'diclo'] },
  { id: 'ibuprofen', synonyms: ['ibuprofen', 'brufen', 'combiflam'] },
  { id: 'cetirizine', synonyms: ['cetirizine', 'cetrizine', 'okacet', 'alerid'] },
  { id: 'levocet', synonyms: ['levocetirizine', 'levocet', 'xyzal'] },
  { id: 'montelukast', synonyms: ['montelukast', 'montair', 'telekast'] },
  { id: 'atorva', synonyms: ['atorvastatin', 'atorva', 'atorlip', 'lipitor'] },
  { id: 'rosuva', synonyms: ['rosuvastatin', 'rosuva', 'rosulip', 'crestor'] },
  { id: 'metformin', synonyms: ['metformin', 'glycomet', 'glucophage'] },
  { id: 'glimepiride', synonyms: ['glimepiride', 'amaryl', 'gp'] },
  { id: 'telmisartan', synonyms: ['telmisartan', 'telma', 'tazloc'] },
  { id: 'amlodipine', synonyms: ['amlodipine', 'amlodac', 'stamlo', 'norvasc'] },
  { id: 'vitamin-d', synonyms: ['cholecalciferol', 'vitamin d', 'vitamin d3', 'udrise', 'calcirol'] },
  { id: 'vitamin-c', synonyms: ['ascorbic acid', 'vitamin c', 'limcee', 'celin'] },
  { id: 'ors', synonyms: ['ors', 'electral', 'rehydration'] },
];
