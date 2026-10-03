/* WHAT A PAYMENT IS IN THE BOOKS: the kinds payments_method_valid takes (011),
   in the words a clerk reads. Each hotel's own methods (payment_methods, 192,
   the owner's D27-259) name one of these: "Agoda" is Bill to company, and the
   reports count it there. The payment door (postings.ts, takeFolioPayment)
   takes only a method on the hotel's list that is On. */
export const PAYMENT_KINDS: Record<string, string> = {
  cash: "Cash", card: "Card", upi: "UPI", bank_transfer: "Bank transfer",
  cheque: "Cheque", wallet: "Wallet", netbanking: "Net banking",
  city_ledger: "Bill to company",
};
