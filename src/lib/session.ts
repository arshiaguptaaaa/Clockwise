import { cookies } from "next/headers";

// Authentication is simulated for this prototype (see spec §9): the "signed
// in" traveller is just a cookie pointing at a seeded User id. No passwords,
// no sessions table — swapping in real auth later only touches this file.
const SESSION_COOKIE = "clockwise_user_id";

export async function getCurrentUserId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

export async function setCurrentUserId(userId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearCurrentUser() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
