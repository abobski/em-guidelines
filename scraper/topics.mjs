// Fixed topic vocabulary. The summarizer tags every guideline and every RebelEM/ALiEM post with
// 1-3 of these, so topic pages and guideline <-> discussion cross-references line up exactly.
// Add topics freely; renaming one re-groups everything tagged with it.
export const TOPICS = [
  // Cardiovascular
  'Acute coronary syndrome / STEMI', 'Chest pain evaluation', 'Atrial fibrillation & flutter', 'Supraventricular tachycardia',
  'Ventricular arrhythmias', 'Bradycardia & heart block', 'Syncope', 'Acute heart failure', 'Hypertensive emergency & elevated BP',
  'Aortic dissection & aortic disease', 'Pericarditis & myocarditis', 'Endocarditis', 'Peripheral arterial disease & limb ischemia',
  'Cardiomyopathy & valvular disease', 'Congenital heart disease', 'Kawasaki disease & MIS-C', 'Cardiogenic shock',
  // VTE / heme
  'Pulmonary embolism', 'Deep vein thrombosis', 'Anticoagulation & reversal', 'Heparin-induced thrombocytopenia',
  'Sickle cell disease', 'Anemia & transfusion', 'Bleeding disorders', 'Oncologic emergencies & febrile neutropenia',
  // Resuscitation / critical care
  'Cardiac arrest & CPR', 'Post-cardiac arrest care', 'Neonatal resuscitation', 'Pediatric resuscitation',
  'Sepsis & septic shock', 'Shock & vasopressors', 'Fluid resuscitation', 'Airway management & RSI', 'Mechanical ventilation & ARDS',
  'Procedural sedation & analgesia', 'Pain management & opioids', 'Massive transfusion & hemorrhage control',
  'Mass casualty & disaster', 'Delirium & agitation',
  // Neuro
  'Acute ischemic stroke', 'Transient ischemic attack', 'Intracerebral hemorrhage', 'Subarachnoid hemorrhage',
  'Seizures & status epilepticus', 'Febrile seizure', 'Headache & migraine', 'Dizziness & vertigo', 'Altered mental status',
  'Meningitis & encephalitis', 'Neuromuscular weakness (GBS, myasthenia)', 'Brain death & neuroprognostication',
  'Idiopathic intracranial hypertension & raised ICP',
  // Trauma / ortho
  'Traumatic brain injury & concussion', 'Cervical spine injury', 'Chest trauma & rib fractures', 'Abdominal & solid organ trauma',
  'Pelvic trauma', 'Geriatric trauma', 'Pediatric trauma', 'Burns', 'Fractures & orthopedic injuries', 'Splinting & reductions',
  'Child abuse & non-accidental trauma', 'Sexual assault', 'Strangulation', 'Wound care & lacerations',
  // Pulm / ID
  'Asthma', 'COPD', 'Pneumonia', 'Bronchiolitis', 'Croup', 'BRUE', 'Pneumothorax', 'COVID-19 & respiratory viruses',
  'Urinary tract infection', 'Skin & soft tissue infection', 'Necrotizing soft tissue infection', 'Bone & joint infection',
  'Febrile infant', 'Fever in children', 'Sexually transmitted infections & PID', 'HIV & post-exposure prophylaxis',
  'Clostridioides difficile', 'Antibiotic stewardship', 'Tick-borne & zoonotic infection',
  // GI / surgical
  'Appendicitis', 'Bowel obstruction', 'Upper GI bleeding', 'Lower GI bleeding', 'Pancreatitis', 'Biliary disease & cholecystitis',
  'Diverticulitis', 'Liver disease & cirrhosis', 'Gastroenteritis & dehydration', 'Constipation', 'Foreign body ingestion',
  'Intussusception & pediatric surgical abdomen', 'Hernia & acute abdomen', 'Inflammatory bowel disease',
  // Renal / GU / endocrine
  'Kidney injury & electrolytes', 'Hyperkalemia', 'Sodium disorders', 'Nephrolithiasis', 'Testicular & ovarian torsion',
  'Diabetic ketoacidosis & HHS', 'Hypoglycemia', 'Thyroid & adrenal emergencies', 'Nephrotic syndrome',
  // OB/GYN
  'Early pregnancy & ectopic', 'Hypertensive disorders of pregnancy', 'Obstetric hemorrhage', 'Abnormal uterine bleeding',
  'Emergency delivery & peripartum care',
  // Tox / environmental
  'Acetaminophen poisoning', 'Opioid overdose & use disorder', 'Alcohol withdrawal & use disorder', 'Toxic alcohols',
  'Cardiotoxic drug overdose', 'Carbon monoxide & inhalation injury', 'Envenomation & bites', 'Cannabis', 'Other poisonings',
  'Heat illness', 'Hypothermia & cold injury', 'Drowning',
  // Allergy / derm / ENT / eye
  'Anaphylaxis & allergic reactions', 'Angioedema', 'Dermatologic emergencies', 'Epistaxis', 'ENT infections & otitis',
  'Peritonsillar & deep neck infection', 'Eye emergencies',
  // Behavioral
  'Suicide risk & psychiatric emergencies', 'Psychosis', 'Eating disorders',
  // Neonatal / pediatrics
  'Neonatal jaundice', 'Neonatal & NICU care', 'Pediatric general care',
  // Systems / misc
  'Imaging & ultrasound', 'ECG interpretation', 'Clinical decision rules', 'Geriatric emergency care', 'Palliative & end-of-life care',
  'ED operations & quality', 'Medical education', 'Wellness & workforce', 'Other',
];

export const CATEGORIES = [
  'Allergy & Dermatology', 'Behavioral Health', 'Cardiology', 'DVT / PE', 'ENT & Ophthalmology', 'Endocrine & Metabolic',
  'Gastroenterology & Surgery', 'Hematology & Oncology', 'Infectious Disease', 'Neonatal', 'Neurology', 'OB/GYN',
  'Renal & Urology', 'Respiratory', 'Resuscitation & Critical Care', 'Toxicology', 'Trauma & Orthopedics', 'General',
];
