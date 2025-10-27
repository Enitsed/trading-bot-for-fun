import './styles/globals.css';

export const metadata = {
  title: '실시간 트레이딩 현황',
  description: 'RSI 리버전 스캐퍼 실시간 모니터링',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
