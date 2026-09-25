import { useEffect } from 'react';

// Este proyecto no usa CSS Modules: el CSS de cada página se bundlea junto y aplica…
export function usePageBodyClass(className) {
  useEffect(() => {
    if (!className) return undefined;
    document.body.classList.add(className);
    return () => {
      document.body.classList.remove(className);
    };
  }, [className]);
}
