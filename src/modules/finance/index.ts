/* The front door of the Finance service — the only file another service
   may import (src/test/boundaries.test.ts). It grows as the service's files
   move in; see MODULE.md. */
export { getFolio, listOpenFolios } from "./data/folios";
export { getFolioBalance } from "./data/postings";
export { FolioPanel } from "./flows/FolioPanel";
export { TaxRulesCard } from "./flows/TaxRulesCard";
