import { createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';

import { buildLoginHref, isProtectedRoute } from '../auth/paths';
import { getSupabaseEnv } from './env';

export async function updateSession(request: NextRequest) {
  const { supabasePublishableKey, supabaseUrl } = getSupabaseEnv();

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, options, value }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (isProtectedRoute(request.nextUrl.pathname) && (!user || error)) {
    return NextResponse.redirect(
      new URL(buildLoginHref(request.nextUrl.pathname), request.url),
    );
  }

  return response;
}
