import { getAuth } from "firebase-admin/auth";
import { firebaseApp } from "./auth.ts";

/* ══════════════════════════════════════════════════════════════════
   MAKING SOMEBODY ABLE TO SIGN IN

   ⚠ THIS IS THE HALF THE SYSTEM NEVER HAD. `POST /admin/staff` wrote a
   Postgres row and stopped. The person then existed in the PMS,
   appeared on the People screen with their role and their property —
   and had no Firebase account, so there was no password anywhere in
   the world that would let them in. The owner found it the ordinary
   way, by adding a demo user and walking to the sign-in page.

   Filling the gap meant `npm run link-staff` in a terminal on the
   Oracle box, after creating the account by hand in the Firebase
   console. That is not a workflow a hotel can run.

   TWO SYSTEMS, ONE PERSON, AND THE JOIN IS `staff.firebase_uid`.
   Firebase answers *who are you*; Postgres answers *what may you do*.
   Neither knows about the other except through that column, so every
   function here ends by handing back a uid for the caller to store —
   and a caller that forgets to store it has created an account nobody
   can reach, which is the same defect one layer along.

   ⚠ AN ACCOUNT MAY ALREADY EXIST. Somebody re-invited, somebody
   created in the console last month, somebody whose staff row was
   deactivated and is coming back. Firebase answers `auth/email-
   already-exists`, and treating that as an error would refuse the most
   ordinary case there is. It is looked up and adopted instead.
   ══════════════════════════════════════════════════════════════════ */

/** The shortest password Firebase itself will accept is six. This asks
    for eight, because the difference costs nothing at the moment
    somebody types it and the alternative is a hotel where every
    terminal password is the property code. */
export const MIN_PASSWORD = 8;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD) {
    return `A password is at least ${MIN_PASSWORD} characters. It is typed `
      + "at a terminal in front of guests, so make it something they can "
      + "remember rather than something they will write on the monitor.";
  }
  /* Deliberately not a character-class rule. "Must contain a symbol"
     produces `Akkalkot1!` on every terminal in the group, which is
     worse than a long phrase, and refuses passwords that are fine. */
  if (/^(.)\1+$/.test(password)) {
    return "That is one character repeated. Anything else.";
  }
  return null;
}

export interface AccountResult {
  uid: string;
  /** True when Firebase already knew this address and it was adopted
      rather than created — the ordinary case for a re-invite. */
  existed: boolean;
}

/**
 * Creates the Firebase account for an email, or adopts the one that is
 * already there, and sets the password when one is given.
 *
 * Returns the uid. THE CALLER MUST STORE IT: an account whose uid
 * never reaches `staff.firebase_uid` authenticates fine and resolves
 * to nobody, which looks to the person like an empty application
 * rather than like a fault.
 */
export async function ensureAccount(
  email: string, displayName: string, password?: string,
): Promise<AccountResult> {
  const auth = getAuth(firebaseApp());

  try {
    const user = await auth.createUser({
      email,
      displayName,
      ...(password ? { password } : {}),
      /* Not verified. Nobody has clicked anything — this address was
         typed by a manager, and marking it verified would be this
         system asserting something it does not know. */
      emailVerified: false,
    });
    return { uid: user.uid, existed: false };
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "auth/email-already-exists") throw e;

    /* ⚠ ADOPTED, NOT REFUSED. A person re-invited is the common case;
       so is one whose account was made in the console before this
       endpoint existed. Refusing here would send a manager to a
       terminal on the server, which is the workflow being replaced. */
    const user = await auth.getUserByEmail(email);
    if (password) await auth.updateUser(user.uid, { password });
    return { uid: user.uid, existed: true };
  }
}

/** Sets the password on an account that already exists. */
export async function setAccountPassword(
  uid: string, password: string,
): Promise<void> {
  await getAuth(firebaseApp()).updateUser(uid, { password });
}

/**
 * A link the person opens to choose their own password.
 *
 * ⚠ NOTHING CALLS THIS, ON PURPOSE. Asked how a new person gets a
 * password, the owner chose a typed one over the option that offered
 * both, so the endpoint that used to call this was removed the same
 * afternoon rather than shipped with no caller. It stays here because
 * it is four lines and the day somebody asks for email invitations it
 * is the whole of the work; the route is not, which is why the route
 * went.
 *
 * ⚠ AND IT DOES NOT SEND ANYTHING. Firebase generates the link;
 * sending it needs SMTP this deployment does not have.
 */
/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export async function passwordSetLink(email: string): Promise<string> {
  return getAuth(firebaseApp()).generatePasswordResetLink(email);
}

/**
 * Switches an account off in Firebase as well as in Postgres.
 *
 * ⚠ DEACTIVATING ONLY THE STAFF ROW LEAVES A WORKING ACCOUNT. The
 * token still verifies; `app.current_user_id()` still resolves through
 * `firebase_uid`; RLS is what stops them, and it stops them because
 * `is_active` is false in a dozen policies. That is one predicate
 * between a dismissed employee and the system. Disabling the account
 * as well means the token is refused before any of that is reached.
 */
export async function disableAccount(uid: string): Promise<void> {
  await getAuth(firebaseApp()).updateUser(uid, { disabled: true });
}

export async function enableAccount(uid: string): Promise<void> {
  await getAuth(firebaseApp()).updateUser(uid, { disabled: false });
}
