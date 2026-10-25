// CRS sandbox test personas, from @crscreditapi/crs-calhacks-mcp-server@1.1.2.
// The identities themselves (name, SSN, address) are not in the repo: set them
// on the Convex deployment as CRS_PERSONAS_JSON = {"P05": {firstName, lastName, ssn, addresses}, ...}.
// CRS rules: use only the provided test identities against the sandbox.
export type CrsPersona = {
  id: string;
  name: string;
  profile: string;
  summary: string;
  expected: string;
  config: string;
};

export const CRS_PERSONAS: CrsPersona[] = [
  {
    "id": "P01",
    "name": "MARGARET OKAFOR",
    "profile": "Prime",
    "summary": "Long, clean credit history, low utilization, no public records, identity verifies cleanly.",
    "expected": "(TU / EFX / EXP): 790 / 790 / 790 clean",
    "config": "exp-prequal-vantage4"
  },
  {
    "id": "P05",
    "name": "RICKY DALTON",
    "profile": "Subprime",
    "summary": "Maxed out cards, several late payments, two collections and a lot of recent credit shopping.",
    "expected": "(TU / EFX / EXP): 540 / 540 / 540, collections, 90dpd",
    "config": "exp-prequal-vantage4"
  },
  {
    "id": "P18",
    "name": "TERRENCE ABERNATHY",
    "profile": "Rebuilding",
    "summary": "Two charge-offs in 2020 that were later paid, nothing negative since, score climbing; the classic second-chance applicant.",
    "expected": "(TU / EFX / EXP): 650 / 650 / 650",
    "config": "exp-prequal-vantage4"
  }
];
