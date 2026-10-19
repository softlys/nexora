/**
 * Fictional reference data for the seed. Every company, person, domain and phone
 * number is invented. Domains use the reserved .example TLD and phone numbers use
 * the 555 fictional range so nothing points at a real business or person.
 */
import type { CompanySize, LifecycleStage } from "../entities";

export type CompanyFixture = {
  name: string;
  slug: string;
  industry: string;
  size: CompanySize;
  country: string;
  city: string;
  street: string;
  dial: string;
  lifecycle: LifecycleStage;
};

export const COMPANY_FIXTURES: CompanyFixture[] = [
  { name: "Brennholt Foundry Works", slug: "brennholt", industry: "Metal Fabrication", size: "201-500", country: "DE", city: "Dortmund", street: "Hafenstrasse 41", dial: "+49", lifecycle: "customer" },
  { name: "Calloway Freight Systems", slug: "calloway-freight", industry: "Logistics", size: "501-1000", country: "US", city: "Columbus", street: "1820 Riverside Dr", dial: "+1", lifecycle: "customer" },
  { name: "Northmere Dairy Cooperative", slug: "northmere-dairy", industry: "Food Processing", size: "201-500", country: "NL", city: "Leeuwarden", street: "Zuiderkade 12", dial: "+31", lifecycle: "customer" },
  { name: "Quarrow Aggregates", slug: "quarrow", industry: "Mining", size: "51-200", country: "GB", city: "Sheffield", street: "Unit 7, Tinsley Park", dial: "+44", lifecycle: "prospect" },
  { name: "Solvane Energy Partners", slug: "solvane", industry: "Energy", size: "1000+", country: "NO", city: "Stavanger", street: "Strandkaien 9", dial: "+47", lifecycle: "customer" },
  { name: "Tamberlane Packaging", slug: "tamberlane", industry: "Packaging", size: "51-200", country: "PL", city: "Poznan", street: "ul. Gorna Wilda 88", dial: "+48", lifecycle: "customer" },
  { name: "Verdant Fields Agritech", slug: "verdant-fields", industry: "Agriculture", size: "11-50", country: "ES", city: "Zaragoza", street: "Calle del Molino 3", dial: "+34", lifecycle: "prospect" },
  { name: "Halcyon Pharma Manufacturing", slug: "halcyon-pharma", industry: "Pharmaceuticals", size: "501-1000", country: "BE", city: "Ghent", street: "Industrieweg 210", dial: "+32", lifecycle: "customer" },
  { name: "Ironwake Shipyards", slug: "ironwake", industry: "Shipbuilding", size: "1000+", country: "DK", city: "Esbjerg", street: "Dokvej 5", dial: "+45", lifecycle: "partner" },
  { name: "Pellmar Construction Group", slug: "pellmar", industry: "Construction", size: "501-1000", country: "FR", city: "Lyon", street: "18 Rue des Chantiers", dial: "+33", lifecycle: "customer" },
  { name: "Ostrava Precision Castings", slug: "ostrava-castings", industry: "Metal Fabrication", size: "201-500", country: "CZ", city: "Ostrava", street: "Prumyslova 14", dial: "+420", lifecycle: "customer" },
  { name: "Kestrel Ridge Water Authority", slug: "kestrel-ridge", industry: "Water Treatment", size: "201-500", country: "CA", city: "Calgary", street: "455 Bow Valley Trail", dial: "+1", lifecycle: "prospect" },
  { name: "Marigold Bottling Co.", slug: "marigold-bottling", industry: "Food Processing", size: "51-200", country: "MX", city: "Monterrey", street: "Av. Industrial 902", dial: "+52", lifecycle: "customer" },
  { name: "Aldwick Aerostructures", slug: "aldwick-aero", industry: "Aerospace", size: "501-1000", country: "GB", city: "Bristol", street: "Filton Business Park 3", dial: "+44", lifecycle: "prospect" },
  { name: "Fenwright Facilities", slug: "fenwright", industry: "Facilities Management", size: "201-500", country: "US", city: "Denver", street: "77 Market Plaza", dial: "+1", lifecycle: "customer" },
  { name: "Lindqvarn Timber", slug: "lindqvarn", industry: "Forestry", size: "51-200", country: "SE", city: "Sundsvall", street: "Sagverksvagen 21", dial: "+46", lifecycle: "churned" },
  { name: "Corvalis Automotive Parts", slug: "corvalis-auto", industry: "Automotive", size: "1000+", country: "IT", city: "Turin", street: "Via delle Officine 56", dial: "+39", lifecycle: "customer" },
  { name: "Redgate Cold Storage", slug: "redgate-cold", industry: "Logistics", size: "11-50", country: "AU", city: "Brisbane", street: "14 Wharf Rd", dial: "+61", lifecycle: "prospect" },
  { name: "Brightwater Utilities", slug: "brightwater", industry: "Utilities", size: "1000+", country: "US", city: "Sacramento", street: "300 Capitol Mall", dial: "+1", lifecycle: "customer" },
  { name: "Hollin & Graves Brewing", slug: "hollin-graves", industry: "Food Processing", size: "11-50", country: "IE", city: "Cork", street: "Lower Glanmire Rd 9", dial: "+353", lifecycle: "prospect" },
  { name: "Tessaro Ceramics", slug: "tessaro", industry: "Manufacturing", size: "51-200", country: "PT", city: "Aveiro", street: "Rua da Fabrica 17", dial: "+351", lifecycle: "customer" },
  { name: "Grauwald Recycling", slug: "grauwald", industry: "Waste Management", size: "201-500", country: "AT", city: "Linz", street: "Industriezeile 33", dial: "+43", lifecycle: "partner" },
  { name: "Saltmarsh Chemicals", slug: "saltmarsh-chem", industry: "Chemicals", size: "501-1000", country: "NL", city: "Rotterdam", street: "Botlekweg 120", dial: "+31", lifecycle: "customer" },
  { name: "Arrowfield Robotics", slug: "arrowfield", industry: "Manufacturing", size: "11-50", country: "JP", city: "Nagoya", street: "3-12 Minato-machi", dial: "+81", lifecycle: "prospect" },
  { name: "Copperline Rail Services", slug: "copperline-rail", industry: "Transportation", size: "201-500", country: "BR", city: "Curitiba", street: "Rua Ferroviaria 640", dial: "+55", lifecycle: "customer" },
];

export const FIRST_NAMES = [
  "Amara", "Bastian", "Clara", "Dmitri", "Elif", "Felix", "Greta", "Hugo", "Ingrid", "Jonas", "Kaia", "Lars", "Mila", "Nikolai",
  "Oona", "Pavel", "Rosa", "Stefan", "Tove", "Umar", "Vera", "Wim", "Yara", "Zoltan", "Anouk", "Bruno", "Chiara", "Diego",
  "Esme", "Florian", "Hana", "Ivo", "Jana", "Kenji", "Leila", "Mateo", "Nadia", "Oskar", "Priya", "Rafael",
];

export const LAST_NAMES = [
  "Albrecht", "Bergstrom", "Castellanos", "Dragomir", "Eriksen", "Fontaine", "Gallagher", "Hendriks", "Ishikawa", "Jankowski",
  "Kowalczyk", "Lindgren", "Moreau", "Novak", "Oyelaran", "Petrov", "Quintero", "Rasmussen", "Sorensen", "Takahashi",
  "Uhlmann", "Vasquez", "Wojcik", "Yilmaz", "Zeller", "Abernathy", "Brandt", "Carvalho", "Delacroix", "Esposito",
];

export const JOB_TITLES = [
  "Operations Director", "Plant Manager", "Procurement Lead", "Maintenance Supervisor", "Chief Engineer", "Purchasing Manager",
  "Facilities Manager", "Head of Supply Chain", "Production Manager", "CFO", "Technical Buyer", "Site Manager",
];

export const CONTACT_TAGS = ["decision-maker", "technical", "finance", "champion", "procurement", "new"];

export type ProductFixture = { sku: string; name: string; category: string; price: number; tax: number; description: string };

export const PRODUCT_FIXTURES: ProductFixture[] = [
  { sku: "PMP-CF-200", name: "Centrifugal Pump CF-200", category: "Pumps", price: 4850, tax: 20, description: "End-suction centrifugal pump, 200 m3/h, cast iron housing." },
  { sku: "PMP-SB-75", name: "Submersible Pump SB-75", category: "Pumps", price: 2390, tax: 20, description: "Submersible drainage pump for sumps and pits, 7.5 kW." },
  { sku: "PMP-DM-40", name: "Diaphragm Metering Pump DM-40", category: "Pumps", price: 1680, tax: 20, description: "Chemical dosing pump with PTFE diaphragm, 40 l/h." },
  { sku: "CMP-RS-55", name: "Rotary Screw Compressor RS-55", category: "Compressors", price: 18900, tax: 20, description: "55 kW oil-injected rotary screw compressor with VSD." },
  { sku: "CMP-PD-11", name: "Piston Compressor PD-11", category: "Compressors", price: 3450, tax: 20, description: "Two-stage piston compressor, 11 kW, 270 l tank." },
  { sku: "CMP-DRY-120", name: "Refrigerated Air Dryer 120", category: "Compressors", price: 2120, tax: 20, description: "Refrigerated dryer for compressed air, 120 m3/h." },
  { sku: "CNV-BLT-10", name: "Belt Conveyor Module 10 m", category: "Conveyors", price: 7400, tax: 20, description: "Modular flat belt conveyor section, 10 m, 600 mm belt." },
  { sku: "CNV-RLR-05", name: "Gravity Roller Conveyor 5 m", category: "Conveyors", price: 1290, tax: 20, description: "Galvanized gravity roller conveyor, 5 m section." },
  { sku: "MTR-IE4-15", name: "IE4 Induction Motor 15 kW", category: "Motors & Drives", price: 1940, tax: 20, description: "Super premium efficiency motor, 4-pole, foot mounted." },
  { sku: "MTR-VFD-22", name: "Variable Frequency Drive 22 kW", category: "Motors & Drives", price: 2680, tax: 20, description: "VFD with built-in EMC filter and fieldbus option." },
  { sku: "MTR-GBX-90", name: "Helical Gearbox HG-90", category: "Motors & Drives", price: 1560, tax: 20, description: "Helical inline gearbox, ratio 1:20, 900 Nm." },
  { sku: "SAF-GRD-KIT", name: "Machine Guarding Kit", category: "Safety", price: 980, tax: 20, description: "Modular mesh guarding panels with interlock switch." },
  { sku: "SAF-LOTO-50", name: "Lockout-Tagout Station 50", category: "Safety", price: 640, tax: 20, description: "Wall-mounted LOTO station with 50 padlocks and tags." },
  { sku: "SAF-GAS-4", name: "4-Gas Detector Pack", category: "Safety", price: 2150, tax: 20, description: "Portable gas detectors (O2, CO, H2S, LEL), pack of five." },
  { sku: "MH-PLT-25", name: "Electric Pallet Truck 2.5 t", category: "Material Handling", price: 6900, tax: 20, description: "Walk-behind electric pallet truck, lithium battery." },
  { sku: "MH-HST-2", name: "Electric Chain Hoist 2 t", category: "Material Handling", price: 3280, tax: 20, description: "Chain hoist with trolley, dual speed, 6 m lift." },
  { sku: "TLS-TRQ-SET", name: "Industrial Torque Wrench Set", category: "Tools", price: 720, tax: 20, description: "Calibrated torque wrenches, 20-850 Nm, in case." },
  { sku: "TLS-ALN-LSR", name: "Laser Shaft Alignment Tool", category: "Tools", price: 5400, tax: 20, description: "Dual-laser shaft alignment system with tablet app." },
  { sku: "SPR-SEAL-KIT", name: "Mechanical Seal Kit", category: "Spare Parts", price: 310, tax: 20, description: "Replacement mechanical seals for CF-series pumps." },
  { sku: "SPR-BRG-SET", name: "Bearing Replacement Set", category: "Spare Parts", price: 455, tax: 20, description: "Matched bearing set for IE4 motors 11-22 kW." },
];

export const DEAL_NAME_TEMPLATES = [
  "{company} pump line upgrade",
  "{company} compressed air retrofit",
  "{company} conveyor expansion",
  "{company} drive modernization",
  "{company} safety compliance package",
  "{company} maintenance tooling",
  "{company} warehouse handling fleet",
  "{company} spare parts framework",
  "{company} energy efficiency program",
  "{company} new site fit-out",
];

export const LOST_REASONS = ["Lost to competitor on price", "Budget frozen", "Project postponed", "Chose in-house solution", "No decision"];

export const NEXT_ACTIONS = [
  "Send revised quote",
  "Schedule site visit",
  "Book technical demo",
  "Confirm budget owner",
  "Share reference case",
  "Follow up on proposal",
  "Prepare framework agreement",
];

export const ACTIVITY_SUBJECTS: Record<"call" | "meeting" | "email" | "note" | "follow_up", string[]> = {
  call: ["Discovery call", "Pricing call", "Technical clarification call", "Check-in call", "Delivery coordination call"],
  meeting: ["Site visit", "Technical workshop", "Quarterly business review", "Proposal walkthrough", "Commissioning meeting"],
  email: ["Sent product datasheets", "Shared revised quote", "Sent reference case study", "Confirmed delivery window", "Replied to RFQ questions"],
  note: ["Budget approved for next quarter", "Competitor quoted lower lead time", "Maintenance team prefers VFD option", "Procurement requires three quotes"],
  follow_up: ["Followed up on open quote", "Followed up after site visit", "Followed up on payment"],
};

export const TASK_TITLES = [
  "Prepare quote for {company}",
  "Call {contact} about delivery",
  "Send datasheets to {contact}",
  "Follow up on proposal with {company}",
  "Confirm installation date with {company}",
  "Review payment terms for {company}",
  "Schedule technical demo for {company}",
  "Update forecast for {company}",
  "Collect site measurements at {company}",
  "Check stock for {company} order",
];
