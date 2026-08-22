/**
 * Deep links to source transactions in Xero, QuickBooks, and Iplicit.
 * Ported from FinancialScalingSherpa.Utilities.CommonFunctions (Version 2.0).
 */

export type AccountingPlatform = "xero" | "quickbooks" | "iplicit";

/** Normalise type keys for lookup (strip spaces, uppercase). */
function normTypeKey(type: string): string {
  return String(type || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

export function getXeroTransactionLink(transactionType: string, transactionLinkId: string): string {
  if (!transactionLinkId?.trim()) return "#";
  if (normTypeKey(transactionType) === "PLANNEDTRANSACTION") return "#";

  const key = normTypeKey(transactionType);
  const pathByType: Record<string, string> = {
    ACCREC: "/AccountsReceivable/Edit.aspx?invoiceID=",
    ACCPAY: "/AccountsPayable/Edit.aspx?invoiceID=",
    ACCRECCREDIT: "/AccountsReceivable/ViewCreditNote.aspx?creditNoteID=",
    ACCPAYCREDIT: "/AccountsPayable/ViewCreditNote.aspx?creditNoteID=",
    APPREPAYMENT: "/AccountsPayable/View.aspx?prepaymentID=",
    PREPAYMENT: "/AccountsReceivable/View.aspx?prepaymentID=",
    APOVERPAYMENT: "/AccountsPayable/View.aspx?overpaymentID=",
    OVERPAYMENT: "/AccountsReceivable/View.aspx?overpaymentID=",
    ACCPAYPAYMENT: "/AccountsPayable/View.aspx?invoiceid=",
    ACCRECPAYMENT: "/Payments/View.aspx?paymentID=",
    SPEND: "/BankTransactions/View.aspx?bankTransactionID=",
    RECEIVE: "/BankTransactions/View.aspx?bankTransactionID=",
    CASHPAID: "/Bank/ViewTransaction.aspx?bankTransactionID=",
    CASHREC: "/Bank/ViewTransaction.aspx?bankTransactionID=",
    TRANSFER: "/Bank/ViewTransaction.aspx?bankTransactionID=",
    EXPENSECLAIM: "/ExpenseClaims/View.aspx?expenseClaimID=",
    MANUALJOURNAL: "/GeneralJournal/View.aspx?journalID=",
    BANKTRANSFER: "/BankTransfers/View.aspx?bankTransferID=",
  };

  const path = pathByType[key];
  if (!path) return "#";
  return `https://go.xero.com${path}${transactionLinkId}`;
}

export function getQuickBooksTransactionLink(transactionType: string, transactionLinkId: string): string {
  if (!transactionLinkId?.trim()) return "#";

  const key = transactionType.trim();
  const pathByType: Record<string, string> = {
    "Credit Card Credit": "/app/creditcardcredit?txnId=",
    Bill: "/app/bill?txnId=",
    "Sales Receipt": "/app/salesreceipt?txnId=",
    "Sales Tax Payment": "/app/global_tax_pmt?txnId=",
    Check: "/app/check?txnId=",
    Cheque: "/app/check?txnId=",
    "Journal Entry": "/app/journal?txnId=",
    "Credit Memo": "/app/creditmemo?txnId=",
    Payment: "/app/recvpayment?txnId=",
    Transfer: "/app/transfer?txnId=",
    "Inventory Qty Adjust": "/app/inventory_quantity_adj?txnId=",
    Invoice: "/app/invoice?txnId=",
    Pledge: "/app/invoice?txnId=",
    Deposit: "/app/deposit?txnId=",
    "Bill Payment (Check)": "/app/billpayment?txnId=",
    "Bill Payment (Cheque)": "/app/billpayment?txnId=",
    "Bill Payment (Credit Card)": "/app/billpaymentcc?txnId=",
    Expense: "/app/expense?txnId=",
    "Vendor Credit": "/app/vendorcredit?txnId=",
    "Purchase Order": "/app/purchaseorder?txnId=",
  };

  const path = pathByType[key];
  if (!path) return "#";
  return `https://app.qbo.intuit.com${path}${transactionLinkId}`;
}

function iplicitHost(domain: string): string {
  const trimmed = domain.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed.replace(/\/$/, "");
  if (trimmed.includes(".")) return `https://${trimmed}`.replace(/\/$/, "");
  return `https://${trimmed}.iplicit.com`;
}

/** Best-effort Iplicit web UI deep link (requires tenant domain from integration). */
export function getIplicitTransactionLink(
  domain: string | null | undefined,
  docClass: string,
  docId: string
): string {
  if (!domain?.trim() || !docId?.trim()) return "#";
  const base = iplicitHost(domain);
  const key = normTypeKey(docClass);
  const routeByClass: Record<string, string> = {
    CASHPAID: "BankPayment",
    CASHREC: "BankReceipt",
    BANKPAYMENT: "BankPayment",
    BANKRECEIPT: "BankReceipt",
    PAYMENT: "BankPayment",
    RECEIPT: "BankReceipt",
    SALESINVOICE: "SalesInvoice",
    PURCHASEINVOICE: "PurchaseInvoice",
    SALESRECEIPT: "SalesReceipt",
    PURCHASERECEIPT: "PurchaseReceipt",
    JOURNAL: "Journal",
    TRANSFER: "BankTransfer",
  };
  const route = routeByClass[key] || docClass.replace(/\s+/g, "");
  return `${base}/Home#/${route}/${docId}`;
}

export function resolveAccountingTransactionLink(params: {
  platform: AccountingPlatform;
  transactionType: string;
  linkId: string;
  iplicitDomain?: string | null;
}): string {
  const { platform, transactionType, linkId, iplicitDomain } = params;
  switch (platform) {
    case "xero":
      return getXeroTransactionLink(transactionType, linkId);
    case "quickbooks":
      return getQuickBooksTransactionLink(transactionType, linkId);
    case "iplicit":
      return getIplicitTransactionLink(iplicitDomain, transactionType, linkId);
    default:
      return "#";
  }
}

/** Map Xero bank feed type (RECEIVE/SPEND) to link type keys. */
export function xeroBankFeedLinkType(type: string): string {
  const t = normTypeKey(type);
  if (t === "RECEIVE") return "RECEIVE";
  if (t === "SPEND") return "SPEND";
  return t || "SPEND";
}
