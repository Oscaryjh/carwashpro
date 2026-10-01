import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessContext } from "@/lib/tenant";
import { listWalletOffers } from "@/lib/wallet/ui-adapter";
import { WalletOffers } from "@/components/wallet/wallet-offers";
import { isWalletAccessAllowed } from "@/lib/wallet/release-policy";

export default async function WalletOffersPage() {
  const { user, businessId, access } = await requireBusinessContext();
  if (access.effectiveBusinessRole !== "BUSINESS_OWNER") notFound();
  if (!isWalletAccessAllowed({ businessId })) return <section className="content"><Link href="/crm">← Customers</Link><p>Member Wallet is not enabled for this business.</p></section>;
  const offers = await listWalletOffers({ businessId, user, branchId: null, shiftId: null });
  return <section className="content"><Link href="/crm">← Customers</Link><WalletOffers businessId={businessId} initialOffers={offers} /></section>;
}
