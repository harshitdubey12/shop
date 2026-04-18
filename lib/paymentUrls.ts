import { safeBookingAmount } from "./amounts";

export function buildUpiUri(params: {
  upiId: string;
  payeeName: string;
  amount: number;
  transactionNote?: string;
}) {
  if (!params.upiId?.trim()) return "";
  const am = safeBookingAmount(params.amount).toFixed(2);
  const pn = encodeURIComponent(params.payeeName);
  const pa = encodeURIComponent(params.upiId);
  const tn = encodeURIComponent(params.transactionNote ?? "Barber booking");
  return `upi://pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR&tn=${tn}`;
}

export function buildGooglePayUri(params: {
  upiId: string;
  payeeName: string;
  amount: number;
}) {
  if (!params.upiId?.trim()) return "";
  const am = safeBookingAmount(params.amount).toFixed(2);
  const pn = encodeURIComponent(params.payeeName);
  const pa = encodeURIComponent(params.upiId);
  return `tez://upi/pay?pa=${pa}&pn=${pn}&am=${am}&cu=INR`;
}
