import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './styles/globals.css';

export const metadata: Metadata = {
  title: '실시간 트레이딩 현황',
  description: 'RSI 리버전 스캐퍼 실시간 모니터링',
};

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps): JSX.Element {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
