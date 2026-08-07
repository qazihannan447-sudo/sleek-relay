'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

type PrefetchOnIntentLinkProps = React.ComponentProps<typeof Link> & {
  prefetchHref?: string;
};

export function PrefetchOnIntentLink({
  onFocus,
  onMouseEnter,
  prefetchHref,
  ...props
}: PrefetchOnIntentLinkProps) {
  const router = useRouter();

  function prefetchRelatedRoute() {
    if (prefetchHref) {
      void router.prefetch(prefetchHref);
    }
  }

  return (
    <Link
      {...props}
      onFocus={(event) => {
        prefetchRelatedRoute();
        onFocus?.(event);
      }}
      onMouseEnter={(event) => {
        prefetchRelatedRoute();
        onMouseEnter?.(event);
      }}
    />
  );
}
