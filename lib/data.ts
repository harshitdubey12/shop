import type { Barber, Service } from "./types";

export const SERVICES: Service[] = [
  {
    id: "cut-classic",
    name: "Signature Cut",
    description: "Consultation, precision cut, styling finish, and hot towel neck clean up.",
    price: 899,
    durationMins: 45,
    icon: "✂",
  },
  {
    id: "fade",
    name: "Skin Fade",
    description: "Graduated fade, line up, detail work, and matte clay styling.",
    price: 1099,
    durationMins: 55,
    icon: "◐",
  },
  {
    id: "beard",
    name: "Beard Architecture",
    description: "Shape, razor line up, steam towel, beard oil, and skin calming balm.",
    price: 649,
    durationMins: 35,
    icon: "⌇",
  },
  {
    id: "combo",
    name: "Chairman Combo",
    description: "Full cut, beard sculpt, double steam towel, scalp massage, cologne mist.",
    price: 1599,
    durationMins: 75,
    icon: "◆",
    mostPopular: true,
  },
];

export const BARBERS: Barber[] = [
  {
    id: "b1",
    name: "Marcus Cole",
    specialty: "Fades and texture",
    image:
      "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80",
  },
  {
    id: "b2",
    name: "Daniel Brooks",
    specialty: "Classic and executive cuts",
    image:
      "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=400&q=80",
  },
  {
    id: "b3",
    name: "Rahul Iyer",
    specialty: "Same day and walk in coordination",
    image:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80",
  },
];

export const WHY_POINTS = [
  {
    title: "Medical grade hygiene",
    body: "Single use capes, hospital grade disinfectant between every guest, and HEPA filtered air.",
  },
  {
    title: "Senior barbers only",
    body: "Every stylist has a decade plus on the floor. No junior cuts, no rushed appointments.",
  },
  {
    title: "Modern techniques",
    body: "European scissors, cordless precision clippers, and styling products curated for Indian hair.",
  },
  {
    title: "Private lounge seating",
    body: "Quiet chairs, espresso on arrival, and phone charging so you can work while you wait.",
  },
];

export const TESTIMONIALS = [
  {
    quote: "Best fade in town. Zero awkward phase, and the line up stayed sharp for two weeks.",
    name: "Rohan Mehta",
    role: "Product lead",
  },
  {
    quote: "Feels closer to a five star hotel than a barbershop. Spotless, calm, and on time.",
    name: "Arjun Khanna",
    role: "Founder",
  },
  {
    quote: "They actually listen. Left with a style that fits my face shape and office dress code.",
    name: "Vikram Singh",
    role: "Consultant",
  },
  {
    quote: "The beard trim is surgical. Hot towel finish is worth the upgrade every single visit.",
    name: "Kabir Malhotra",
    role: "Architect",
  },
];

export const GALLERY_ITEMS = [
  {
    id: "g1",
    src: "https://images.unsplash.com/photo-1621605815971-fbc98d665033?w=800&q=80",
    label: "Low drop fade",
    category: "haircut" as const,
  },
  {
    id: "g2",
    src: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=1200&q=80",
    label: "Beard line up",
    category: "beard" as const,
  },
  {
    id: "g3",
    src: "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?w=800&q=80",
    label: "Classic taper",
    category: "haircut" as const,
  },
  {
    id: "g4",
    src: "https://images.unsplash.com/photo-1622286342621-4bd786c2447c?w=800&q=80",
    label: "Texture crop",
    category: "haircut" as const,
  },
  {
    id: "g5",
    src: "https://images.unsplash.com/photo-1605497788044-5a32c7078486?auto=format&fit=crop&w=1200&q=80",
    label: "Before and after fade",
    category: "before_after" as const,
  },
  {
    id: "g6",
    src: "https://images.unsplash.com/photo-1585747860715-2ba37e788b70?w=800&q=80",
    label: "Straight razor finish",
    category: "beard" as const,
  },
  {
    id: "g7",
    src: "https://images.unsplash.com/photo-1516975080664-ed2fc6a32937?w=800&q=80",
    label: "Interior mood",
    category: "salon" as const,
  },
  {
    id: "g8",
    src: "https://images.unsplash.com/photo-1521490683712-35a1cb235434?w=800&q=80",
    label: "Executive side part",
    category: "haircut" as const,
  },
];
