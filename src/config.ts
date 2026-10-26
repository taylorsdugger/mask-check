export interface County {
  state: string;
  county: string;
  fips: string;
}

export interface Area {
  id: string;
  name: string;
  note?: string;
  // Wastewater plants count when they serve one of these counties. Rt and ED
  // trends come from each county's health service area.
  counties: County[];
  // "highest" takes the worst plant. "typical" takes the level most people in
  // the area are at, so one bad neighborhood in a big city doesn't decide it.
  level: "highest" | "typical";
}

// Mercer County has no plant in the CDC network. Scott County (Davenport) is
// across the river from Rock Island and shares Muscatine's health service
// area, so it fills the gap.
export const HOME: Area = {
  id: "home",
  name: "Rock Island, Mercer and Muscatine counties",
  counties: [
    { state: "Illinois", county: "Rock Island", fips: "17161" },
    { state: "Illinois", county: "Mercer", fips: "17131" },
    { state: "Iowa", county: "Muscatine", fips: "19139" },
    { state: "Iowa", county: "Scott", fips: "19163" },
  ],
  level: "highest",
};

export const OTHER_AREAS: Area[] = [
  {
    id: "chicago",
    name: "Chicago",
    counties: [{ state: "Illinois", county: "Cook", fips: "17031" }],
    level: "typical",
  },
  {
    id: "des-moines",
    name: "Des Moines",
    counties: [{ state: "Iowa", county: "Polk", fips: "19153" }],
    level: "typical",
  },
  {
    id: "nyc",
    name: "New York City",
    note: "CDC has no plants in the five boroughs, so this uses Westchester, just north of the Bronx.",
    counties: [{ state: "New York", county: "Westchester", fips: "36119" }],
    level: "typical",
  },
];

export const ALL_AREAS = [HOME, ...OTHER_AREAS];

export type Virus = "covid" | "flu" | "rsv";

export const VIRUSES: { id: Virus; name: string; wastewater: string; rt: string; ed: string }[] = [
  { id: "covid", name: "COVID", wastewater: "SARS-CoV-2", rt: "COVID-19", ed: "ed_trends_covid" },
  { id: "flu", name: "Flu", wastewater: "Influenza A virus", rt: "Influenza", ed: "ed_trends_influenza" },
  { id: "rsv", name: "RSV", wastewater: "RSV", rt: "RSV", ed: "ed_trends_rsv" },
];
