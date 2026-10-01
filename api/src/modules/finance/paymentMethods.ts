/* THE PAYMENT METHODS THE SERVER TAKES: the word a clerk reads, and the value
   the database stores (payments_method_valid). The payment door
   (postings.ts, takeFolioPayment) refuses anything not named here.

   In a file of its own, with nothing imported, so the website's test can read
   it beside the list the screens offer (src/lib/rules.ts PAYMENT_METHODS,
   src/modules/finance/paymentMethods.test.ts): the screens offered
   "Google Pay", which was never here, and the advance was refused after the
   booking had saved (the owner, 30 September). */
export const PAYMENT_METHOD: Record<string, string> = {
  Cash: "cash", UPI: "upi", "Credit Card": "card", "Debit Card": "card",
  "Net Banking": "netbanking", Wallet: "wallet", Cheque: "cheque",
  "Bank Transfer": "bank_transfer", "Bill to company": "city_ledger",
  "Room Posting": "city_ledger",
};
