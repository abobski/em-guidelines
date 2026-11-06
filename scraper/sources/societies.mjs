// Literature-backed sources: each one searches specific journals for guidelines on
// EM-relevant topics, so new guidelines appear automatically at the next monthly run.
// To add a society, add an entry to SOCIETIES.
import { searchGuidelines } from '../lit.mjs';
import { litRecord } from './acc.mjs';

const SOCIETIES = [
  {
    id: 'vte',
    name: 'DVT / PE',
    homepage: 'https://www.hematology.org/education/clinicians/guidelines-and-quality-care/clinical-practice-guidelines/venous-thromboembolism-guidelines',
    population: 'Adult',
    // CHEST, ASH (Blood Adv), ESC, ISTH, ERS, ACEP, AHA
    issns: ['0012-3692', '1931-3543', '2473-9529', '2473-9537', '0195-668X', '1522-9645', '1538-7933', '1538-7836', '0903-1936', '0196-0644', '0009-7322', '1524-4539'],
    titleTerms: ['venous thromboembolism', 'pulmonary embolism', 'deep vein thrombosis', 'thromboembolic', 'venous thrombosis', 'anticoagulation', 'anticoagulant', 'thromboprophylaxis', 'heparin-induced'],
    allowStatements: true,
    since: '2016-01-01',
  },
  {
    id: 'sccm',
    name: 'Sepsis & Critical Care',
    homepage: 'https://www.sccm.org/clinical-resources/guidelines',
    population: 'Adult',
    issns: ['0090-3493', '1530-0293', '0342-4642', '1432-1238'],
    titleTerms: ['sepsis', 'septic', 'shock', 'acute respiratory distress', 'corticosteroid', 'fluid', 'airway', 'intubation', 'agitation', 'delirium', 'acute liver failure', 'gastrointestinal bleeding', 'transfusion'],
    since: '2016-01-01',
  },
  {
    id: 'idsa',
    name: 'IDSA / ATS',
    homepage: 'https://www.idsociety.org/practice-guideline/practice-guidelines/',
    population: 'Adult',
    issns: ['1058-4838', '1537-6591', '1073-449X', '1535-4970'],
    titleTerms: ['pneumonia', 'skin and soft tissue', 'urinary tract', 'pyelonephritis', 'meningitis', 'encephalitis', 'clostridioides', 'clostridium difficile', 'influenza', 'neutropenia', 'lyme', 'tick', 'endocarditis', 'osteomyelitis', 'diabetic foot', 'pharyngitis', 'sinusitis', 'intra-abdominal', 'syphilis', 'sexually transmitted', 'post-exposure', 'asthma', 'copd', 'chronic obstructive'],
    since: '2014-01-01',
  },
  {
    id: 'trauma',
    name: 'Trauma & Surgery (EAST/WSES)',
    homepage: 'https://www.east.org/education-resources/practice-management-guidelines',
    population: 'Adult',
    issns: ['2163-0755', '2163-0763', '1749-7922'],
    titleTerms: ['trauma', 'injury', 'injuries', 'fracture', 'hemorrhage', 'bleeding', 'burn', 'rib', 'pelvic', 'spine', 'splenic', 'liver', 'appendicitis', 'cholecystitis', 'diverticulitis', 'bowel obstruction', 'pancreatitis', 'necrotizing', 'abdomen', 'abdominal', 'reversal', 'tourniquet', 'geriatric', 'hernia', 'volvulus', 'perforat'],
    since: '2016-01-01',
  },
  {
    id: 'saem',
    name: 'SAEM GRACE',
    homepage: 'https://www.saem.org/publications/grace',
    population: 'Adult',
    issns: ['1069-6563', '1553-2712'],
    titleTerms: ['GRACE', 'guideline', 'guidelines'],
    since: '2018-01-01',
  },
  {
    id: 'neuro',
    name: 'Neurocritical Care / AAN',
    homepage: 'https://www.aan.com/practice/guidelines',
    population: 'Adult',
    issns: ['1541-6933', '1556-0961', '0028-3878', '1526-632X'],
    titleTerms: ['status epilepticus', 'seizure', 'stroke', 'intracerebral', 'subarachnoid', 'traumatic brain', 'intracranial', 'encephalitis', 'meningitis', 'guillain', 'myasthenia', 'headache', 'migraine', 'spinal cord', 'coma', 'brain death', 'neuromuscular', 'anticoagulant reversal'],
    since: '2016-01-01',
  },
  {
    id: 'esc',
    name: 'ESC (European Cardiology)',
    homepage: 'https://www.escardio.org/Guidelines',
    population: 'Adult',
    issns: ['0195-668X', '1522-9645'],
    titleTerms: ['acute coronary', 'myocardial', 'chest pain', 'pulmonary embolism', 'syncope', 'atrial fibrillation', 'ventricular arrhythmias', 'sudden cardiac death', 'heart failure', 'pericardial', 'myocarditis', 'endocarditis', 'aortic', 'hypertension', 'bradycardia', 'pacing', 'supraventricular'],
    include: /\bESC\b[^:]*\bGuidelines?\b|\bTask Force\b/,
    exclude: /^The (\d{4} )?ESC Guidelines/i, // EHJ commentary pieces about a guideline
    since: '2015-01-01',
  },
  {
    id: 'aap',
    name: 'AAP (Pediatrics)',
    homepage: 'https://publications.aap.org/pediatrics/collection/1023/Clinical-Practice-Guidelines',
    population: 'Pediatric',
    issns: ['0031-4005', '1098-4275'],
    titleTerms: ['febrile infant', 'febrile', 'bronchiolitis', 'urinary tract', 'otitis', 'brief resolved', 'seizure', 'concussion', 'head injury', 'hyperbilirubinemia', 'sinusitis', 'pneumonia', 'dehydration', 'gastroenteritis', 'abuse', 'sedation', 'anaphylaxis', 'asthma', 'croup', 'pain', 'poisoning', 'suicide', 'sickle', 'fever', 'obesity', 'hypertension', 'apparent life', 'sepsis', 'diabetic ketoacidosis'],
    since: '2014-01-01',
  },
  {
    id: 'gi',
    name: 'ACG (GI)',
    homepage: 'https://gi.org/guidelines/',
    population: 'Adult',
    issns: ['0002-9270', '1572-0241'],
    titleTerms: ['bleeding', 'hemorrhage', 'pancreatitis', 'biliary', 'liver failure', 'liver injury', 'hepatic encephalopathy', 'cirrhosis', 'foreign bod', 'caustic', 'diverticulitis', 'colitis', 'esophag', 'gastrointestinal', 'clostridioides', 'alcohol-associated'],
    since: '2015-01-01',
  },
  {
    id: 'resus',
    name: 'Resuscitation (ERC/ILCOR)',
    homepage: 'https://cprguidelines.eu/',
    population: 'Adult',
    issns: ['0300-9572', '1873-1570'],
    titleTerms: ['resuscitation', 'cardiac arrest', 'life support', 'post-resuscitation', 'first aid', 'drowning', 'hypothermia', 'termination'],
    allowStatements: true,
    since: '2020-01-01',
  },
  {
    id: 'tox',
    name: 'Toxicology (AACT/EXTRIP)',
    homepage: 'https://www.extrip-workgroup.org/recommendations',
    population: 'Adult',
    issns: ['1556-3650', '1556-9519'],
    titleTerms: ['poisoning', 'overdose', 'extracorporeal', 'EXTRIP', 'antidote', 'toxicity', 'ingestion', 'envenomation', 'exposure'],
    allowStatements: true,
    since: '2015-01-01',
  },
];

export const sources = SOCIETIES.map((cfg) => ({
  id: cfg.id,
  name: cfg.name,
  homepage: cfg.homepage,
  population: cfg.population,
  async fetchGuidelines({ log }) {
    const hits = await searchGuidelines({ ...cfg, log });
    return hits.map((h) => litRecord(h, true));
  },
}));
