import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAdminAuthenticated } from "@/lib/admin-auth";

// Route handlers don't inherit the /admin/waitlist layout's guard, so this
// checks the admin session itself.
function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export async function GET() {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const signups = await prisma.waitlistSignup.findMany({ orderBy: { createdAt: "desc" } });

  const header = ["email", "createdAt", "source", "medium", "campaign", "referrer"];
  const rows = signups.map((s) =>
    [s.email, s.createdAt.toISOString(), s.source ?? "", s.medium ?? "", s.campaign ?? "", s.referrer ?? ""]
      .map((v) => csvEscape(String(v)))
      .join(",")
  );
  const csv = [header.join(","), ...rows].join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clockwise-waitlist-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
