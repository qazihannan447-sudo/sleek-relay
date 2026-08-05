'use client';

import { useActionState } from 'react';

import { initialLoginState, type LoginFormState } from './form-state';
import { login } from './actions';

type LoginFormProps = {
  nextPath: string;
};

export function LoginForm({ nextPath }: LoginFormProps) {
  const [state, formAction, isPending] = useActionState<LoginFormState, FormData>(
    login,
    initialLoginState,
  );

  return (
    <form action={formAction} className="auth-form">
      <input name="next" type="hidden" value={nextPath} />

      <div className="field">
        <label htmlFor="email">Email address</label>
        <input
          autoComplete="email"
          id="email"
          name="email"
          placeholder="you@business.com"
          required
          type="email"
        />
      </div>

      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          autoComplete="current-password"
          id="password"
          name="password"
          placeholder="Enter your password"
          required
          type="password"
        />
      </div>

      {state.error ? (
        <div className="notice notice-danger">{state.error}</div>
      ) : null}

      <button className="button" disabled={isPending} type="submit">
        {isPending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}
