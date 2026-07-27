import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { resolveBusinessAccess } from "@/lib/business-groups/business-access";
import { prisma } from "@/lib/prisma";
import { canReadWhatsAppUnreadCount } from "@/lib/whatsapp/unread-access";

export async function GET() {
  const session = await getSession();

  if (!session || session.status !== "active" || !session.businessId) {
    return NextResponse.json({ unreadCount: 0 }, { status: 401 });
  }

  const access = await resolveBusinessAccess({
    userId: session.userId,
    requestedBusinessId: session.businessId,
  });

  if (
    !access.granted ||
    !access.businessId ||
    !canReadWhatsAppUnreadCount(session, access)
  ) {
    return NextResponse.json({ unreadCount: 0 }, { status: 403 });
  }

  const aggregate = await prisma.whatsAppConversation.aggregate({
    where: {
      businessId: access.businessId,
      unreadCount: { gt: 0 },
    },
    _sum: { unreadCount: true },
  });

  return NextResponse.json({
    unreadCount: aggregate._sum.unreadCount ?? 0,
  });
}
