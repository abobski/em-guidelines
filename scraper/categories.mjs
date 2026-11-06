// Title/summary keyword -> clinical category. First match wins, so order matters
// (more specific rules above broader ones). Add rules here as new sources arrive.
export const CATEGORY_RULES = [
  ['Gastroenterology & Surgery', /foreign body ingestion|pyloric|gastrostomy|g-tube|gj or g|peptic ulcer|bile duct|colonic obstruction|malnutrition|nutrition|enzyme replacement/i],
  ['Toxicology', /acetaminophen|apap|overdose|poison|toxic|ingestion|opioid|cannabis|carbon monoxide|envenomation|antidote|extracorporeal treatment|withdrawal|\blead\b/i],
  ['Trauma & Orthopedics', /trauma|fracture|cervical spine|c-spine|concussion|burn|laceration|sprain|dislocation|strangulation|organ injury|head injury|brain injury|spinal cord injury|\babuse\b|assault|injuries|tourniquet|rib|pelvic|splenic|hemorrhage control|torticollis|scoliosis|osteotomy|spine growing/i],
  ['ENT & Ophthalmology', /epistaxis|nasal|otitis|\bears?\b|pharyngitis|tonsil|peritonsillar|\beye|orbital|globe|sinusitis|ankyloglossia|tongue|airway foreign/i],
  ['Resuscitation & Critical Care', /major medical event|cardiac arrest|resuscitat|life support|\bshock\b|sepsis|septic|sedation|\brsi\b|intubation|airway|critically ill|respiratory distress syndrome|drowning|hypothermia|mass casualty|multiple patient events|thermoregulation|vascular access/i],
  ['DVT / PE', /pulmonary embol|venous thrombo|thromboembol|deep vein|\bdvt\b|\bvte\b|thromboprophylaxis|heparin-induced|anticoagula|direct oral anticoagulants/i],
  ['Cardiology', /coronary|\bacs\b|stemi|myocardial infarction|chest pain|heart failure|atrial fibrillation|arrhythm|tachycardia|bradycardia|conduction|syncope|(?<!intracranial )hypertension(?! in pregnancy)|blood pressure|aortic|valv|cardiomyopathy|congenital heart|transposition|\bpda\b|qtc|pulse loss|pericard|myocarditis|peripheral artery|dyslipidemia|cardiovascular|revascularization|kawasaki|cardiac(?! arrest)/i],
  ['Neurology', /seizure|epilep|intracranial|headache|migraine|stroke|ischemic attack|neuro|encephalitis|encephalopathy|guillain|myasthenia|subarachnoid|intracerebral|coma|brain death|ataxia|weakness|vertigo|dizziness|vestibular|delirium|hydrocephalus|eeg/i],
  ['Neonatal', /neonatal|newborn|nicu|delivery management|lactation|inhaled nitric|hypoxic-ischemic|metabolic bone|hyperbilirubinemia/i],
  ['OB/GYN', /uterine|obstetric|pregnan|ectopic|ovarian|vaginal|preeclampsia|sexually transmitted|pelvic inflammatory|menstrua|contracept/i],
  ['Infectious Disease', /\bfebrile|fever|osteomyelitis|soft tissue|cellulitis|abscess|\buti\b|urinary tract|pyelonephritis|difficile|endocarditis|mis-c|meningitis|lyme|tick|infectious|infection|arthritis, infectious|septic arthritis|influenza|neutropenia|hiv|syphilis|antibiotic|antimicrobial|bite|botulism|mpox/i],
  ['Respiratory', /asthma|bronchiolitis|croup|pneumonia|covid|respiratory|brue|wheez|pneumothorax|pneumomediastinum|copd|obstructive pulmonary|airway clearance|tracheostomy|ventilat|pulmonary hemorrhage/i],
  ['Endocrine & Metabolic', /diabet|ketoacidosis|dka|hyperkalemia|hyponatremia|hypernatremia|hyperammonemia|adrenal|hypoglyc|hypocalc|calcium|thyroid|iv fluid|electrolyte|metabolic|obesity|bmi|lipid|mitochondrial|bone density|beckwith/i],
  ['Hematology & Oncology', /anemia|iron deficiency|thrombo|sickle|neutropenia|bleeding disorder|hemophilia|transfusion|oncolog|leukemia|tumor|cancer|platelet|von willebrand/i],
  ['Gastroenterology & Surgery', /gastro|dehydration|constipation|fecal|emesis|vomit|intussusception|appendic|bowel|abdomen|abdominal|pancreatitis|biliary|liver|hepat|cirrhosis|colitis|esophag|diverticulitis|cholecystitis|hernia|volvulus|caustic|feeding|ostomy/i],
  ['Renal & Urology', /nephrotic|renal|kidney|testic|hematuria|urolog|hydronephrosis|pyeloplasty|nephr/i],
  ['Allergy & Dermatology', /anaphylaxis|allerg|dermatitis|eczema|urticaria|rash|skin|scalded|stevens-johnson/i],
  ['Behavioral Health', /food refusal|agitation|suicid|psychiatr|psychosis|behavioral|eating disorder|adhd|autism|anxiety|depress|\bocd\b|mental health|substance|tics|tourette|somatic symptom|foster care/i],
];

export function categorize(title, summary = '') {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(title)) return cat;
  for (const [cat, re] of CATEGORY_RULES) if (re.test(summary)) return cat;
  return 'General';
}
