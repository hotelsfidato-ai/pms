/* ══════════════════════════════════════════════════════════════════
   GOOGLE'S OWN SIGN-IN BUTTON (D27-207) - loaded only on the tap

   "Continue with Google" is Google Identity Services: Google's script
   draws Google's button, the guest picks an account in Google's own window,
   and the page is handed a signed answer to post to the door. The door
   checks it; this file checks nothing.

   ⚠ IT IS SOMEBODY ELSE'S SCRIPT ON THE ONE PAGE A STRANGER OPENS, so it is
   not in the bundle and not loaded on opening: only when the guest presses
   "Continue with Google", and only from accounts.google.com. A guest who
   uses a code never runs it. (The way with no script at all, a full-page
   redirect to Google, is open in DEFECTS.md.)

   No Firebase, no account: the answer is used once, for the unlock.
   ══════════════════════════════════════════════════════════════════ */

export interface GoogleSignIn {
  initialize(options: { client_id: string; callback: (answer: { credential?: string }) => void }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

declare global {
  interface Window { google?: { accounts: { id: GoogleSignIn } } }
}

let loading: Promise<GoogleSignIn> | null = null;

export function loadGoogleSignIn(): Promise<GoogleSignIn> {
  loading ??= new Promise<GoogleSignIn>((resolve, reject) => {
    const failed = () => { loading = null; reject(new Error("Google could not be reached.")); };
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => (window.google ? resolve(window.google.accounts.id) : failed());
    script.onerror = failed;
    document.head.append(script);
  });
  return loading;
}
