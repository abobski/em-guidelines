// Title/summary keyword -> clinical category. First match wins, so order matters
// (more specific rules above broader ones). Add rules here as new sources arrive.
export const CATEGORY_RULES = [
  ['Gastroenterology & Surgery', /foreign body ingestion|pyloric|gastrostomy/i],
  ['Toxicology', /acetaminophen|apap|overdose|poison|toxic|ingestion/i],
  ['Trauma & Orthopedics', /trauma|fracture|cervical spine|c-spine|concussion|burn|laceration|sprain|dislocation|strangulation|solid organ injury/i],
  ['ENT & Ophthalmology', /epistaxis|nasal|otitis|\bears?\b|pharyngitis|tonsil|\beye|orbital|globe/i],
  ['Neurology', /seizure|epilep|intracranial|headache|stroke|neuro/i],
  ['Resuscitation & Critical Care', /major medical event|cardiac arrest|resuscitat|\bshock\b|sepsis|sedation|\brsi\b|intubation|airway/i],
  ['Neonatal', /neonatal|nicu|delivery management|lactation|inhaled nitric|hypoxic-ischemic|metabolic bone|hyperbilirubinemia/i],
  ['OB/GYN', /uterine|obstetric|pregnan|ectopic|ovarian|vaginal|preeclampsia|sexually transmitted|pelvic inflammatory/i],
  ['Infectious Disease', /\bfebrile|fever|osteomyelitis|soft tissue|cellulitis|abscess|\buti\b|urinary tract|difficile|endocarditis|mis-c|meningitis|lyme/i],
  ['Respiratory', /asthma|bronchiolitis|croup|pneumonia|covid|respiratory|brue|wheez|pneumothorax|pneumomediastinum/i],
  ['Endocrine & Metabolic', /diabet|ketoacidosis|dka|hyperkalemia|hyponatremia|hyperammonemia|adrenal|hypoglyc|iv fluid/i],
  ['Hematology & Oncology', /anemia|iron deficiency|pulmonary embolism|thrombo|sickle|neutropenia|bleeding disorder|hemophilia|transfusion/i],
  ['Gastroenterology & Surgery', /gastro|dehydration|constipation|fecal|emesis|vomit|intussusception|appendic|bowel|abdomen|pancreatitis/i],
  ['Cardiology', /kawasaki|syncope|svt|arrhythm|myocarditis|cardiac/i],
  ['Renal & Urology', /nephrotic|renal|kidney|testic|hematuria/i],
  ['Allergy & Dermatology', /anaphylaxis|allerg|dermatitis|eczema|urticaria|rash/i],
  ['Behavioral Health', /food refusal|agitation|suicid|psychiatr|psychosis|behavioral|eating disorder/i],
];

export function categorize(title, summary = '') {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(summary)) return cat;
  return 'General';
}
