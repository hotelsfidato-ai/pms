/* The front door of Contracts (D27-184) - the only file another service may
   import (src/test/boundaries.test.ts). The company dialog, for Companies
   and agents' Add company (C-13); the contract price, for the booking page. */
export { CompanyDialog } from "./components/CompanyDialog";
export { getContractTariff, type ContractTariff } from "./data/contracts";
