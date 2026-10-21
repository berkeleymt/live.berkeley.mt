import { useEffect, useRef, useState } from 'react';

interface GoogleIdentity {
  initialize(options: { client_id: string; callback: (result: { credential?: string }) => void; use_fedcm_for_prompt: boolean; use_fedcm_for_button: boolean; auto_select: boolean }): void;
  renderButton(element: HTMLElement, options: { type: string; theme: string; size: string; text: string; width: number }): void;
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } } } }

/** Google owns this button and credential collection; Live verifies every credential server-side. */
export function GoogleSignIn({ clientId, busy, signIn }: { clientId: string; busy: boolean; signIn: (credential: string) => Promise<boolean> }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => { if (active) setState('error'); }, 15_000);
    function ready() {
      if (!active || !container.current || !window.google?.accounts.id) return;
      clearTimeout(timer);
      window.google.accounts.id.initialize({
        client_id: clientId, use_fedcm_for_prompt: true, use_fedcm_for_button: true, auto_select: false,
        callback: ({ credential }) => { if (active && credential) void signIn(credential); },
      });
      container.current.replaceChildren();
      window.google.accounts.id.renderButton(container.current, { type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', width: 260 });
      setState('ready');
    }
    const failed = () => { if (active) { clearTimeout(timer); setState('error'); } };
    let script = document.querySelector<HTMLScriptElement>('#live-google-identity');
    if (window.google?.accounts.id) ready();
    else {
      if (!script) {
        script = document.createElement('script');
        script.id = 'live-google-identity';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        document.head.append(script);
      }
      script.addEventListener('load', ready);
      script.addEventListener('error', failed);
    }
    return () => { active = false; clearTimeout(timer); script?.removeEventListener('load', ready); script?.removeEventListener('error', failed); };
  }, [clientId, signIn, attempt]);
  return <div className="staff-google" aria-busy={busy || state === 'loading'}>
    <p>Sign in with your authorized Google account. A Live Super admin manages access; a Lemon account does not grant Live access.</p>
    {state === 'loading' && <p role="status">Loading Google sign-in…</p>}
    {state === 'error' && <div role="alert" className="staff-note staff-error"><p>Google sign-in could not load. Check your connection or browser restrictions, then retry. Existing Live sessions do not need Google to keep working.</p><button className="staff-button" onClick={() => { document.querySelector('#live-google-identity')?.remove(); setState('loading'); setAttempt(value => value + 1); }}>Retry Google sign-in</button></div>}
    <div ref={container} hidden={state !== 'ready'} inert={busy} />
    {busy && <p role="status">Verifying your account…</p>}
  </div>;
}
