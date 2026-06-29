import { NextResponse } from "next/server";
import { hasStaffPermission } from "@/lib/auth/staff-permissions";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();

  if (!session || session.status !== "active" || !session.businessId) {
    return NextResponse.json({ unreadCount: 0 }, { status: 401 });
  }

  const canUseWhatsApp =
    session.role === "BUSINESS_OWNER" ||
    (session.role === "STAFF" && hasStaffPermission(session, "WHATSAPP"));

  if (!canUseWhatsApp) {
    return NextResponse.json({ unreadCount: 0 }, { status: 403 });
  }

  const aggregate = await prisma.whatsAppConversation.aggregate({
    where: {
      businessId: session.businessId,
      unreadCount: { gt: 0 },
    },
    _sum: { unreadCount: true },
  });

  return NextResponse.json({
    unreadCount: aggregate._sum.unreadCount ?? 0,
  });
}
