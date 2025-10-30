// shared/lib/use-theme.ts
// 테마 전환을 관리하는 커스텀 훅

'use client';

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'scalper-theme';
const DEFAULT_THEME: Theme = 'dark';

/**
 * 테마 설정을 관리하는 커스텀 훅
 */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [mounted, setMounted] = useState(false);

  // 초기 테마 로드 (localStorage 또는 시스템 설정)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;

    if (stored && (stored === 'dark' || stored === 'light')) {
      setTheme(stored);
      applyTheme(stored);
    } else {
      // 시스템 테마 설정 감지
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const systemTheme: Theme = prefersDark ? 'dark' : 'light';
      setTheme(systemTheme);
      applyTheme(systemTheme);
    }

    setMounted(true);
  }, []);

  // 테마 변경 함수
  const toggleTheme = () => {
    const newTheme: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  };

  const setSpecificTheme = (newTheme: Theme) => {
    setTheme(newTheme);
    applyTheme(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  };

  return {
    theme,
    toggleTheme,
    setTheme: setSpecificTheme,
    mounted, // SSR 방지를 위해 mounted 상태 제공
  };
}

/**
 * HTML root 요소에 테마 클래스 적용
 */
function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);

  // color-scheme CSS 속성 설정
  root.style.colorScheme = theme;
}
