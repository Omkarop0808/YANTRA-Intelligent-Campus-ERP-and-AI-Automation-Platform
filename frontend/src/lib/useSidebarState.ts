import { useEffect, useState, useCallback } from 'react';

const STORAGE_KEY = 'sidebar:collapsed';

const isMobileScreen = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 768;
};

const readInitial = (): boolean => {
  if (typeof window === 'undefined') return false;
  if (isMobileScreen()) return true; // Always start collapsed on mobile viewports
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const useSidebarState = () => {
  const [collapsed, setCollapsed] = useState<boolean>(readInitial);

  useEffect(() => {
    // Keep local storage synced only on desktop to avoid locking mobile drawers
    if (!isMobileScreen()) {
      try {
        window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
      } catch {
        /* ignore quota / privacy errors */
      }
    }
  }, [collapsed]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth <= 768) {
        setCollapsed(true);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && !isMobileScreen()) setCollapsed(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback(() => setCollapsed(c => !c), []);
  const close = useCallback(() => setCollapsed(true), []);

  return { collapsed, setCollapsed, toggle, close };
};
