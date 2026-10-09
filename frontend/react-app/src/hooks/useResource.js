// hooks/useResource.js — loads data for a screen: { data, error, loading, reload }.
//
// `loader` is a function returning a promise; `keyParts` is what the request depends on (page, search, id...).
//   * A new key (another page, another exam id) starts a fresh load and shows NO old data.
//   * reload() with the same key keeps showing the previous data while the new answer is fetched, so the
//     screen does not blank out after a registration or a cancellation.
//   * An answer that arrives for an old request is ignored.
// `loading` is derived, so no state is set synchronously inside the effect.

import { useEffect, useRef, useState } from 'react';
import { toApiError } from '../utils/errors';

export function useResource(loader, keyParts) {
  const [reloadCount, setReloadCount] = useState(0);
  const [state, setState] = useState({ requestKey: null, keyBase: null, data: null, error: null });

  const keyBase = JSON.stringify(keyParts);
  const requestKey = `${keyBase}#${reloadCount}`;

  const loaderRef = useRef(loader);
  useEffect(() => {
    loaderRef.current = loader;
  });

  useEffect(() => {
    let cancelled = false;
    loaderRef.current().then(
      (data) => { if (!cancelled) setState({ requestKey, keyBase, data, error: null }); },
      (err) => { if (!cancelled) setState({ requestKey, keyBase, data: null, error: toApiError(err) }); }
    );
    return () => { cancelled = true; };
  }, [requestKey, keyBase]);

  const loading = state.requestKey !== requestKey;
  const sameQuery = state.keyBase === keyBase;
  return {
    data: !loading || sameQuery ? state.data : null,
    error: loading ? null : state.error,
    loading,
    reload: () => setReloadCount((count) => count + 1),
  };
}
